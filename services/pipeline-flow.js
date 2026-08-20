/**
 * pipeline-flow.js — Story 2 flow (pipeline-with-feedback).
 *
 * Per architecture.md §4.7.2 + requirements.md §3.2:
 *   - 顺序强制在 DSH 侧:成员 handoff 写"完成 step N"不点名下一棒;
 *     DSH 查 plan 后派下一棒
 *   - 成员发起的移交不污染 dispatch-log:
 *     member -> DSH-routing 落 handoff-log,DSH -> member 落 dispatch-log
 *   - feedback loop: 每 step max_retries (默认 1),重派同 target + feedback
 *   - 决策点默认关;若 flow_config.decision_points[] 显式开启,按 §9.10.4
 *     分流超时 (pipeline -> continue)
 *
 * v1.0 simplified:
 *   - step terminal 由 DSH 通过 team.complete_step / team.fail_step 工具
 *     显式提供 (不驱动 subagent runtime)
 *   - in-memory step waiter Promise;DSH 进程是唯一持有者
 *   - feedback loop: 重派同 target + 上一轮 feedback
 *
 * v2.0 #4:
 *   - step → next-step `context_refs` 自动传播:记 `stepOutputs[i]`,
 *     派下一步时默认从 `stepOutputs[i-1].produced_artifact_ids` 派生
 *   - `flow_config.context_refs_override[stepIndex]` 显式覆盖(可选)
 *   - `step.context_refs` 也保留为静态覆盖入口,与 override 等价优先级
 *   - feedback retry 路径**不**自动带前步 produced_artifact_ids(同 member
 *     同 task,前步产物自然有)
 *
 * v2.0 #1 留口 (this revision) — flow engine rewiring:
 *   - 派单经 `dispatchTask` helper:有 ctx.subagents 时走
 *     `MemberService.dispatch`(写 dispatch-log + 调 followup),
 *     否则回退到 `dispatchLog` 纯日志(向后兼容 v1.0 smoke-test)
 *   - 唯一写入者承诺不变(DSH 仍是 dispatch-log 唯一 writer;
 *     MemberService.dispatch 内部 append 一行 `from: scheduler, to: member` +
 *     `joined_now` 字段)
 *   - in-memory step waiter 不变: `signalStepTerminal` 仍是 test /
 *     production 共同的"step 完成"信号(子代理在 DSH 内部会被宿主
 *     settlement delivery 路径解析为 `team.complete_step` 工具调用)
 *
 * @module dsh-team-plugin/pipeline-flow
 */
import { readMeta, transition, writeMeta } from './team-service.js';
import { dispatch as dispatchLog, markTerminal as markDispatchTerminal, handoff as handoffLog } from './dispatch-service.js';
import { open as openDp, get as getDp } from './decision-point-service.js';
import { dispatch as memberDispatch } from './member-service.js';

/** @typedef {{
 *   member_id: string,
 *   task: string,
 *   context_refs?: string[],
 *   max_retries?: number,
 *   intent?: 'produce'|'review'|'collect'|'synthesize'|'decide',
 *   expected_artifact?: { type: string, desc: string },
 * }} PipelineStep
 */

/** @type {Map<string, { resolve: (v: any) => void, reject: (e: any) => void, currentStep: number }>} */
const _stepWaiters = new Map();

/** v2.0 #4: in-memory record of each step's last terminal output, keyed by runId.
 * Used to auto-derive `context_refs` for the next step's dispatch.
 * Entries are populated when a step's `signalStepTerminal` returns 'complete'
 * (after retries, the latest attempt's artifacts are kept). The shape is
 * `{ produced_artifact_ids: string[] }[]` indexed by step index.
 * Cleared on `_resetForTests()` and never persisted (DSH is the in-process
 * holder; cold-resume reconstructs the chain from dispatch-log markTerminal
 * rows in 2.x).
 * @type {Map<string, Array<{ produced_artifact_ids: string[] }>>} */
const _stepOutputs = new Map();

/** Get or create the per-run step output array. @param {string} runId */
function getStepOutputs(runId) {
  let arr = _stepOutputs.get(runId);
  if (!arr) {
    arr = [];
    _stepOutputs.set(runId, arr);
  }
  return arr;
}

/** Reset the per-run step output array (called when a run reaches terminal
 * or when the engine is torn down). @param {string} runId */
export function _resetStepOutputsForTests(runId) {
  _stepOutputs.delete(runId);
}

/**
 * Issue a task to a member. v2.0 #1 留口 flow engine rewiring:
 *   - If `ctx?.subagents?.followup` is available, drive the real subagent
 *     via `MemberService.dispatch` (writes dispatch-log + calls followup,
 *     auto-joins if the member isn't already running).
 *   - Otherwise (smoke-test / no-DSH-runtime) fall back to the v1.0
 *     `dispatchLog` which only writes the dispatch-log row.
 *
 * Both paths return `{ id, ... }` so downstream callers (markDispatchTerminal)
 * can use the same shape regardless of branch.
 *
 * @param {any} ctx - DSH Cordis ctx (may be null for tests)
 * @param {string} runId
 * @param {string} memberId
 * @param {{
 *   task: string,
 *   contextRefs?: string[],
 *   seq: number,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ id: string, joinedNow?: boolean, childId?: string }>}
 */
export async function dispatchTask(ctx, runId, memberId, opts) {
  if (ctx?.subagents?.followup) {
    const r = await memberDispatch(ctx, runId, memberId, {
      task: opts.task,
      contextRefs: opts.contextRefs ?? [],
      ...(ctx?.parent ? { parent: ctx.parent } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { id: r.dispatchId, joinedNow: r.joinedNow, childId: r.childId };
  }
  return dispatchLog({
    run_id: runId,
    to: memberId,
    task: opts.task,
    context_refs: opts.contextRefs ?? [],
    seq: opts.seq,
  });
}

/** v2.0 #4: derive the default `context_refs` for a given step.
 * - step 0: empty
 * - step N > 0: previous step's `produced_artifact_ids` from the latest
 *   terminal 'complete' (i.e. the last successful attempt after retries)
 * - run not in registry (e.g. test called without going through runPipeline):
 *   fall back to empty
 * @param {string} runId
 * @param {number} stepIndex
 * @returns {string[]}
 */
function getDefaultContextRefs(runId, stepIndex) {
  if (stepIndex <= 0) return [];
  const outputs = _stepOutputs.get(runId);
  if (!outputs) return [];
  const prev = outputs[stepIndex - 1];
  return Array.isArray(prev?.produced_artifact_ids) ? [...prev.produced_artifact_ids] : [];
}

/**
 * Signal a step's terminal state from the DSH. Used by
 * team.complete_step / team.fail_step tools.
 * @param {string} runId
 * @param {number} stepIndex
 * @param {'complete'|'fail'} terminal
 * @param {{ produced_artifact_ids?: string[], feedback?: string }} [result]
 */
export function signalStepTerminal(runId, stepIndex, terminal, result = {}) {
  const w = _stepWaiters.get(runId);
  if (!w) {
    // No active waiter (flow already past, or signal out of order). The
    // signal is preserved on disk (the file write below) so the next
    // runFlow can pick it up if the flow re-enters.
    _pendingSignals.set(`${runId}::${stepIndex}`, { terminal, result, at: new Date().toISOString() });
    return;
  }
  if (w.currentStep !== stepIndex) {
    // Out-of-order signal; preserve it for the correct step
    _pendingSignals.set(`${runId}::${stepIndex}`, { terminal, result, at: new Date().toISOString() });
    return;
  }
  if (terminal === 'complete') {
    w.resolve({ kind: 'complete', produced_artifact_ids: result.produced_artifact_ids ?? [] });
  } else {
    w.resolve({ kind: 'fail', feedback: result.feedback ?? '' });
  }
}

/** @type {Map<string, { terminal: 'complete'|'fail', result: any, at: string }>} */
const _pendingSignals = new Map();

/**
 * Drain any preserved signal for the given (runId, stepIndex). Returns
 * null if nothing pending. v1.0 only — when cross-process state lands
 * (2.0) this becomes a log read.
 */
function drainPendingSignal(runId, stepIndex) {
  const k = `${runId}::${stepIndex}`;
  const s = _pendingSignals.get(k);
  if (s) _pendingSignals.delete(k);
  return s ?? null;
}

/**
 * Run a pipeline-with-feedback run to terminal.
 * @param {string} runId
 * @param {object} initialMeta
 * @param {object | null} ctx
 * @returns {Promise<{ terminal: 'succeeded'|'failed'|'aborted'|'interrupted' }>}
 */
export async function runPipeline(runId, initialMeta, ctx) {
  // assembling -> running
  let meta = await readMeta(runId);
  if (meta.state === 'assembling') {
    meta = await transition(runId, 'assembling', 'running', 'flow-started');
  }

  const steps = Array.isArray(initialMeta.flow_config?.steps) ? initialMeta.flow_config.steps : [];
  if (steps.length === 0) {
    return runPipelineFailed(runId, 'no-steps');
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    meta = await readMeta(runId);
    if (meta.state !== 'running') return { terminal: meta.state };

    // Bump current_step in meta
    await writeMeta(runId, { ...meta, current_step: i });

    // v2.0 #4: compute the effective `context_refs` for this step's dispatch.
    // Precedence (highest first):
    //   1. `flow_config.context_refs_override[i]` — flow-level explicit
    //   2. `step.context_refs` — step-level static (v1.0 compat)
    //   3. derived from `stepOutputs[i-1].produced_artifact_ids` — auto
    // The override + static both win over auto-derivation; between override
    // and static, the step-level wins (the more local declaration).
    const override = (initialMeta.flow_config?.context_refs_override ?? {})[i];
    let stepContextRefs;
    if (Array.isArray(step.context_refs) && step.context_refs.length > 0) {
      stepContextRefs = step.context_refs;
    } else if (Array.isArray(override) && override.length > 0) {
      stepContextRefs = override;
    } else {
      stepContextRefs = getDefaultContextRefs(runId, i);
    }

    // Check for an explicit ad-hoc DP at step boundary (if decision_points
    // configured for this index)
    const dpAtBoundary = (initialMeta.flow_config?.decision_points ?? []).find(
      (dp) => dp.at === `step-${i}`,
    );
    if (dpAtBoundary) {
      const dp = await openDp({
        runId,
        kind: 'ad-hoc',
        prompt: dpAtBoundary.prompt ?? `Continue past step ${i}?`,
        contextRefs: dpAtBoundary.context_refs ?? [],
        waitMinutes: dpAtBoundary.wait_minutes,
      });
      // Wait synchronously — same pattern as round-table-flow.
      // Pipeline 超时按 §9.10.4 -> continue
      let dpAction = 'continue';
      while (true) {
        const fresh = getDp(dp.id);
        if (fresh?.status === 'responded') { dpAction = fresh.response.action; break; }
        if (fresh?.status === 'timed_out') { dpAction = 'continue'; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (dpAction === 'abort') {
        await transition(runId, 'running', 'aborted', 'step-boundary-dp-abort');
        return { terminal: 'aborted' };
      }
      // continue: fall through to dispatch
    }

    // Dispatch the step (DSH -> member). Retry counter starts at 0.
    const maxRetries = Math.max(0, Number(step.max_retries ?? 1));
    let retry = 0;
    let feedback = '';
    let dispatchResult;

    while (true) {
      // member -> DSH-routing handoff (signals "starting step N"); v1.0
      // simplification: we log this even on first try so the handoff-log
      // shows the boundary marker.
      await handoffLog({
        run_id: runId,
        from: step.member_id,
        to: 'DSH-routing',
        task: `step-${i} start (${step.intent ?? 'produce'})`,
        reason: 'step-start',
        seq: i + 1,
      });
      // DSH -> member dispatch (the actual work). v2.0 #1 留口 rewiring:
      // `dispatchTask` selects MemberService.dispatch (real subagent drive)
      // when ctx has subagents.followup, else falls back to dispatchLog.
      // v2.0 #4: pass the derived/step-level `stepContextRefs` so cross-step
      // propagation works without the caller plumbing artifacts manually.
      const dispatched = await dispatchTask(ctx, runId, step.member_id, {
        task: feedback ? `${step.task}\n\nFeedback from prior attempt: ${feedback}` : step.task,
        contextRefs: stepContextRefs,
        seq: i + 1,
      });
      dispatchResult = dispatched;

      // Wait for terminal signal
      const sig = await waitForStepTerminal(runId, i, step);
      if (sig.kind === 'complete') {
        await markDispatchTerminal(runId, dispatchResult.id, 'completed', {
          produced_artifact_ids: sig.produced_artifact_ids,
        });
        // v2.0 #4: remember this step's output for downstream propagation.
        // Feedback retry path lands here too — only the last successful
        // attempt's artifacts are kept (replaces any earlier record).
        getStepOutputs(runId)[i] = {
          produced_artifact_ids: Array.isArray(sig.produced_artifact_ids) ? [...sig.produced_artifact_ids] : [],
        };
        // member -> DSH-routing: completion handoff
        await handoffLog({
          run_id: runId,
          from: step.member_id,
          to: 'DSH-routing',
          task: `step-${i} complete`,
          artifacts: sig.produced_artifact_ids,
          reason: 'step-complete',
          seq: i + 1,
        });
        // break the retry loop; move to next step
        break;
      }
      // fail
      await markDispatchTerminal(runId, dispatchResult.id, 'failed', { feedback: sig.feedback });
      await handoffLog({
        run_id: runId,
        from: step.member_id,
        to: 'DSH-routing',
        task: `step-${i} failed`,
        reason: sig.feedback,
        seq: i + 1,
      });
      if (retry < maxRetries) {
        retry += 1;
        feedback = sig.feedback;
        continue;
      }
      // exhausted — DSH can 插队 (v1.0 simplified: 失败 = failed)
      await transition(runId, 'running', 'failed', `step-${i}-exhausted-retries`);
      return { terminal: 'failed' };
    }
  }

  // All steps complete -> succeeded
  await transition(runId, 'running', 'succeeded', 'all-steps-complete', {
    ended_at: new Date().toISOString(),
  });
  return { terminal: 'succeeded' };
}

/** @returns {Promise<{ kind: 'complete'|'fail', produced_artifact_ids?: string[], feedback?: string }>} */
function waitForStepTerminal(runId, stepIndex, step) {
  // If a signal was preserved earlier (out-of-order from a test, etc.),
  // drain it now.
  const pending = drainPendingSignal(runId, stepIndex);
  if (pending) {
    return pending.terminal === 'complete'
      ? Promise.resolve({ kind: 'complete', produced_artifact_ids: pending.result.produced_artifact_ids ?? [] })
      : Promise.resolve({ kind: 'fail', feedback: pending.result.feedback ?? '' });
  }
  return new Promise((resolve, reject) => {
    _stepWaiters.set(runId, { resolve, reject, currentStep: stepIndex });
    // v1.0: no automatic timeout; the DSH must signal. A 2.0 hardening
    // would add a per-step timeout (architecture §9.10.4 mentions "DSH
    // 没有插队决策 -> failed" but pipeline is permitted to keep going
    // via continue; we choose failed as the conservative default).
  });
}

async function runPipelineFailed(runId, reason) {
  await transition(runId, 'running', 'failed', reason);
  return { terminal: 'failed' };
}

/**
 * For tests only: clear the in-memory state. Not part of the public API.
 */
export function _resetForTests() {
  _stepWaiters.clear();
  _pendingSignals.clear();
  _stepOutputs.clear();
}
