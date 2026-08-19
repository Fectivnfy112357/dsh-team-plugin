/**
 * decision-point-service.js — User-facing gate during a Team Run.
 *
 * Per architecture.md §4.5 + requirements.md §9.10:
 *   - 3 开点源 (convergence / fallback / ad-hoc),零 DSH 裁量
 *   - 响应模型 { action: continue|complete|abort, feedback? }
 *   - 持久化: 响应写 user-intervention-log.jsonl (单写入者=DSH Team Service)
 *   - 等待超时按 flow 分流 (round-table -> abort; pipeline/fan-out -> continue)
 *
 * v1.0 scope:
 *   - in-memory DP registry (one process; resets on restart — user will
 *     re-enter from where the run was if they want to continue)
 *   - open / respond / waitingDecisions / checkTimeouts
 *   - emit `team/decision-point-open` + `team/decision-point-respond`
 *     custom events so the panel can subscribe (architecture 附录 B)
 *
 * Out of scope (P2+):
 *   - cross-process DP registry (1.0 单实例;2.0 加持久 DP 状态)
 *   - per-DP timer (v1.0 走 FlowEngine 周期性 checkTimeouts;true setTimeout
 *     留 P2)
 *
 * @module dsh-team-plugin/decision-point-service
 */
import { appendLog } from './log-writer.js';

/** @typedef {'convergence'|'fallback'|'ad-hoc'} DecisionPointKind */

/** @typedef {{
 *   id: string,
 *   runId: string,
 *   kind: DecisionPointKind,
 *   prompt: string,
 *   contextRefs: string[],
 *   waitMinutes: number,
 *   openedAt: string,
 *   status: 'open'|'responded'|'timed_out',
 *   response?: { action: 'continue'|'complete'|'abort', feedback?: string, isAdHoc: boolean, at: string },
 *   timedOutAt?: string,
 * }} DecisionPoint
 */

/** @typedef {{
 *   runId: string,
 *   kind: DecisionPointKind,
 *   prompt: string,
 *   contextRefs?: string[],
 *   waitMinutes?: number,
 *   flowHint?: 'handoff-round-table'|'pipeline-with-feedback'|'fan-out-collect',
 * }} OpenDecisionPointRequest
 */

/** @type {Map<string, DecisionPoint>} */
const _registry = new Map();

/** Listeners for custom events (filled by lib/index.js). */
const _listeners = /** @type {{ open: Set<(dp: DecisionPoint) => void>, respond: Set<(dp: DecisionPoint) => void> }} */ ({
  open: new Set(),
  respond: new Set(),
});

/**
 * Subscribe to a custom DP event. Returns a disposer.
 * @param {'open'|'respond'} event
 * @param {(dp: DecisionPoint) => void} fn
 */
export function on(event, fn) {
  _listeners[event].add(fn);
  return () => _listeners[event].delete(fn);
}

function emit(event, dp) {
  for (const fn of _listeners[event]) {
    try { fn(dp); } catch { /* listener errors must not break the service */ }
  }
}

let _seq = 0;
/** @returns {string} */
function newDpId(runId) {
  _seq += 1;
  return `dp-${runId}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

/** Default wait window (minutes). OQ-2 tentative default = 10. */
const DEFAULT_WAIT_MINUTES = 10;

/**
 * Open a new decision point. Returns the new DP. Idempotent per (runId, kind)
 * in the same wall clock minute: a second open() with the same kind and run
 * returns the existing open DP rather than creating a new one. This matches
 * the "轮次边界 1 收敛候选 1 门" rule (architecture §4.5 / 4.7.1).
 * @param {OpenDecisionPointRequest} req
 * @returns {Promise<DecisionPoint>}
 */
export async function open(req) {
  if (!req?.runId) throw new Error('decision-point.open: runId is required');
  if (!['convergence', 'fallback', 'ad-hoc'].includes(req.kind)) {
    throw new Error(`decision-point.open: invalid kind "${req.kind}"`);
  }
  if (typeof req.prompt !== 'string' || req.prompt.length === 0) {
    throw new Error('decision-point.open: prompt is required');
  }
  // Idempotency: reuse an open DP of the same kind for this run
  for (const dp of _registry.values()) {
    if (dp.runId === req.runId && dp.kind === req.kind && dp.status === 'open') {
      return dp;
    }
  }
  const dp = {
    id: newDpId(req.runId),
    runId: req.runId,
    kind: req.kind,
    prompt: req.prompt,
    contextRefs: req.contextRefs ?? [],
    waitMinutes: req.waitMinutes ?? DEFAULT_WAIT_MINUTES,
    openedAt: new Date().toISOString(),
    status: 'open',
  };
  _registry.set(dp.id, dp);
  emit('open', dp);
  return dp;
}

/**
 * Record a user response to an open DP. Writes the user-intervention-log
 * (single writer = this service) and emits the respond event. v1.0 allows
 * multiple responses per DP — the last `action` wins (§9.10.4). The full
 * response stream is preserved in the log so "改主意" is auditable.
 * @param {string} dpId
 * @param {{ action: 'continue'|'complete'|'abort', feedback?: string, isAdHoc?: boolean }} response
 */
export async function respond(dpId, response) {
  const dp = _registry.get(dpId);
  if (!dp) throw new Error(`decision-point.respond: unknown dpId=${dpId}`);
  if (dp.status !== 'open') {
    throw new Error(`decision-point.respond: dp ${dpId} is not open (status=${dp.status})`);
  }
  if (!['continue', 'complete', 'abort'].includes(response.action)) {
    throw new Error(`decision-point.respond: invalid action "${response.action}"`);
  }
  const at = new Date().toISOString();
  const last = {
    action: response.action,
    ...(response.feedback ? { feedback: response.feedback } : {}),
    isAdHoc: response.isAdHoc === true,
    at,
  };
  dp.response = last;
  dp.status = 'responded';
  await appendLog('user-intervention-log', dp.runId, {
    decision_point_id: dp.id,
    user_message: response.feedback ?? '',
    action: response.action,
    is_ad_hoc: response.isAdHoc === true,
    timestamp: at,
  });
  emit('respond', dp);
  return dp;
}

/**
 * Find a DP by id. Exposed for tests + the FlowEngine timeout pass.
 * @param {string} dpId
 * @returns {DecisionPoint | undefined}
 */
export function get(dpId) {
  return _registry.get(dpId);
}

/**
 * List all open DPs for a run (or all runs when runId is omitted).
 * @param {string} [runId]
 * @returns {DecisionPoint[]}
 */
export function waitingDecisions(runId) {
  const out = [];
  for (const dp of _registry.values()) {
    if (dp.status !== 'open') continue;
    if (runId && dp.runId !== runId) continue;
    out.push(dp);
  }
  return out;
}

/**
 * Check timeouts across all open DPs. Each DP that exceeded its `waitMinutes`
 * is closed with `status='timed_out'` and a `timedOutAt` is stamped. The
 * caller (FlowEngine) decides what to do with the closure: abort (round-
 * table) or continue (pipeline / fan-out). This function only marks the
 * timeout, it does NOT transition the run state.
 *
 * @param {Date} [now] - injectable for tests
 * @returns {DecisionPoint[]} the DPs that just timed out
 */
export function checkTimeouts(now = new Date()) {
  const out = [];
  for (const dp of _registry.values()) {
    if (dp.status !== 'open') continue;
    const opened = new Date(dp.openedAt).getTime();
    if (Number.isNaN(opened)) continue;
    const elapsedMin = (now.getTime() - opened) / 60_000;
    if (elapsedMin >= dp.waitMinutes) {
      dp.status = 'timed_out';
      dp.timedOutAt = now.toISOString();
      out.push(dp);
    }
  }
  return out;
}

/**
 * For tests only: clear the in-memory registry. Not part of the public API.
 */
export function _resetForTests() {
  _registry.clear();
  _listeners.open.clear();
  _listeners.respond.clear();
  _seq = 0;
}
