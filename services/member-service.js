/**
 * member-service.js — Member entity + per-Run subagent lifecycle.
 *
 * Per architecture.md §4.2 / §5.2 / §10.2:
 *   - Member = Role instantiation, globally persisted; deletion guarded by
 *     reference checks (team-templates + in-flight runs).
 *   - During a Team Run, each Member is realized as one DSH subagent
 *     (`ctx.subagents.startContinuable` for continuable children).
 *   - `parent` is the live `Agent` of the calling tool's exec context
 *     (per PROGRESS.md 2.0 #1, settled on option A: parent = exec.agent).
 *   - The subagent handle is owned by the DSH continuation manager; team
 *     plugin persists only the durable identity (childId + provider +
 *     label) in `session-state.json`. Cold resume and settlement delivery
 *     go through the manager; team plugin only updates durable state on
 *     join / leave.
 *
 * v1.0 surface: `list` + `get` (CRUD against the global members dir).
 * v2.0 #1 surface (this revision):
 *   - `joinRun(ctx, runId, memberId, opts)` — startContinuable +
 *     session-state.json update + dispatch-log entry.
 *   - `leaveRun(ctx, runId, memberId, opts)` — interrupt (best-effort) +
 *     session-state.json terminated + state-history entry.
 * Remaining (deferred to 2.x — PROGRESS.md §2.0 #1):
 *   - `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff`.
 *
 * @module dsh-team-plugin/member-service
 */
import { existsSync } from 'node:fs';
import { readFile, readFile as _readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths, sessionDir } from './paths.js';
import { writeJsonFile, appendLog } from './log-writer.js';
import { getAdapter, listAdapterIds } from './adapters.js';

/** @typedef {{
 *   id: string,
 *   role_id: string,
 *   display_name: string,
 *   persona: string,
 *   adapter: 'hermes'|'mcode'|'claude-code',
 *   cli_options_override: Record<string, unknown>,
 *   metadata: Record<string, unknown>,
 * }} Member
 */

/** @typedef {{
 *   runId: string,
 *   memberId: string,
 *   parent?: any,        // live Agent (required in production; tests may omit and pass childId only)
 *   prompt?: Array<{ type: string, [k: string]: unknown }>,
 *   signal?: AbortSignal,
 *   persona?: string,
 * }} JoinRunOptions
 */

/** @typedef {{
 *   runId: string,
 *   memberId: string,
 *   reason?: string,
 *   authority?: { kind: 'user', parentSessionId: string } | { kind: 'ancestor', agent: any },
 *   signal?: AbortSignal,
 * }} LeaveRunOptions
 */

/** @typedef {{
 *   childId: string,
 *   messageId: string,
 *   provider: string,
 *   state: 'running',
 * }} JoinRunResult
 */

/** @type {Set<string>} */
const _ADAPTER_IDS = new Set(listAdapterIds());

let _dispatchSeq = 0;
function newDispatchId(runId) {
  _dispatchSeq += 1;
  return `d-${runId}-${Date.now().toString(36)}-${_dispatchSeq.toString(36)}`;
}

/**
 * List all members, sorted by id.
 * @returns {Promise<Member[]>}
 */
export async function list() {
  const dir = getTeamPaths().membersDir;
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of entries) {
    const m = await get(f.replace(/\.json$/, ''));
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {string} id @returns {Promise<Member | undefined>} */
export async function get(id) {
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) return undefined;
  const path = join(getTeamPaths().membersDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, 'utf-8'));
    // Backfill defaults for fields the on-disk format may predate.
    return /** @type {Member} */ ({
      adapter: 'hermes',
      persona: '',
      cli_options_override: {},
      metadata: {},
      ...raw,
    });
  } catch {
    return undefined;
  }
}

/**
 * Internal: read a run-scoped session-state.json. Returns `undefined`
 * when the file is missing or unreadable.
 * @param {string} runId
 * @param {string} memberId
 */
async function readSessionState(runId, memberId) {
  const p = join(sessionDir(runId, memberId), 'session-state.json');
  if (!existsSync(p)) return undefined;
  try { return JSON.parse(await _readFile(p, 'utf-8')); } catch { return undefined; }
}

/**
 * Realise a Member as one continuable DSH subagent inside a Team Run.
 *
 * Per PROGRESS.md 2.0 #1 + architecture §10.2:
 *   1. Resolve the member's adapter (closed set: hermes / mcode / claude-code).
 *   2. Call `ctx.subagents.startContinuable({ provider, label, request: { parent, prompt, ... }, signal })`.
 *      The `parent` is the live `Agent` of the tool's exec context (option A
 *      in the 2.0 #1 design discussion).
 *   3. Update `session-state.json` with `childId`, `provider`, `label`,
 *      `state=running`, and append `childId` to `session_chain`.
 *   4. Append a `kind=member-join` row to `dispatch-log.jsonl`.
 *
 * Idempotency: a second `joinRun(runId, memberId, ...)` returns the
 * existing `state=running` record without re-spawning a child. The
 * caller can check `state` on the returned `JoinRunResult` (always
 * `'running'` in this revision; if the prior state was `terminated`
 * the call rejects — re-joining a terminated member is the caller's
 * signal of confusion; create a fresh run).
 *
 * @param {any} ctx - DSH Cordis ctx (must have `ctx.subagents.startContinuable`)
 * @param {string} runId
 * @param {string} memberId
 * @param {JoinRunOptions} [opts]
 * @returns {Promise<JoinRunResult>}
 */
export async function joinRun(ctx, runId, memberId, opts = {}) {
  if (!ctx || typeof ctx?.subagents?.startContinuable !== 'function') {
    throw new Error('member-service.joinRun: ctx.subagents.startContinuable is required');
  }
  if (!runId) throw new Error('member-service.joinRun: runId is required');
  if (!memberId) throw new Error('member-service.joinRun: memberId is required');
  // Idempotency: if the member is already running, return the existing record.
  const existing = await readSessionState(runId, memberId);
  if (existing?.state === 'running' && existing?.child_id) {
    return {
      childId: existing.child_id,
      messageId: existing.message_id ?? '',
      provider: existing.provider ?? '',
      state: 'running',
    };
  }
  if (existing?.state === 'terminated') {
    throw new Error(`member-service.joinRun: member ${memberId} already terminated in run ${runId}; re-join is not supported`);
  }
  const member = await get(memberId);
  if (!member) {
    throw new Error(`member-service.joinRun: unknown member "${memberId}"`);
  }
  const adapterId = member.adapter;
  if (!_ADAPTER_IDS.has(adapterId)) {
    throw new Error(`member-service.joinRun: member ${memberId} has unknown adapter "${adapterId}" (closed set: ${[..._ADAPTER_IDS].join(', ')})`);
  }
  const adapter = getAdapter(adapterId);
  const label = `${memberId}-${runId}`;
  const prompt = opts.prompt ?? [
    { type: 'text', text: `You are member "${member.display_name ?? memberId}" (role: ${member.role_id}) in run ${runId}. Member global persona: ${member.persona || '(none)'}.` },
  ];
  const startSpec = {
    provider: adapter.provider,
    label,
    request: {
      ...(opts.parent ? { parent: opts.parent } : {}),
      prompt,
      ...(opts.persona || member.persona ? { persona: opts.persona ?? member.persona } : {}),
    },
    signal: opts.signal ?? new AbortController().signal,
  };
  const result = await ctx.subagents.startContinuable(startSpec);
  if (!result?.childId) {
    throw new Error(`member-service.joinRun: startContinuable returned no childId (provider=${adapter.provider})`);
  }
  // Update session-state.json (started from the skeleton markHolder wrote).
  const sessionPath = join(sessionDir(runId, memberId), 'session-state.json');
  const base = existing ?? {
    current_session_id: null,
    session_chain: [],
    handoff_files: [],
    inbox: { pending: [], processed: [] },
    state: 'pending',
    self_handoff_count: 0,
  };
  const chain = Array.isArray(base.session_chain) ? base.session_chain.slice() : [];
  if (!chain.includes(result.childId)) chain.push(result.childId);
  const updated = {
    ...base,
    current_session_id: result.childId,
    session_chain: chain,
    state: 'running',
    provider: adapter.provider,
    adapter: adapterId,
    child_id: result.childId,
    message_id: result.messageId,
    label,
    joined_at: new Date().toISOString(),
  };
  await writeJsonFile(sessionPath, updated);
  // Append a member-join row to dispatch-log.
  await appendLog('dispatch-log', runId, {
    id: newDispatchId(runId),
    timestamp: new Date().toISOString(),
    from: 'DSH',
    to: memberId,
    kind: 'member-join',
    task: `joined run as ${memberId} (${adapter.provider})`,
    child_id: result.childId,
    message_id: result.messageId,
    provider: adapter.provider,
  });
  return {
    childId: result.childId,
    messageId: result.messageId,
    provider: adapter.provider,
    state: 'running',
  };
}

/**
 * Mark a member as having left the run. Updates `session-state.json`
 * to `state=terminated`, writes a state-history row, and best-effort
 * calls `ctx.subagents.interrupt(...)` when an authority is supplied
 * (DSH settlement delivery: the parent of the live child). Without
 * authority, the durable handle is left for the run's terminal
 * `drainContinuableDescendants(...)` call (per architecture §10.2).
 *
 * Idempotent: a second leaveRun on an already-terminated member is a
 * no-op (no error, no log row).
 *
 * @param {any} ctx
 * @param {string} runId
 * @param {string} memberId
 * @param {LeaveRunOptions} [opts]
 * @returns {Promise<{ state: 'terminated'|'running'|'pending', interrupted?: boolean }>}
 */
export async function leaveRun(ctx, runId, memberId, opts = {}) {
  if (!runId) throw new Error('member-service.leaveRun: runId is required');
  if (!memberId) throw new Error('member-service.leaveRun: memberId is required');
  const sessionPath = join(sessionDir(runId, memberId), 'session-state.json');
  const existing = await readSessionState(runId, memberId);
  if (!existing) {
    throw new Error(`member-service.leaveRun: no session-state.json for member ${memberId} in run ${runId}`);
  }
  if (existing.state === 'terminated') {
    return { state: 'terminated' };
  }
  let interrupted = false;
  if (ctx?.subagents?.interrupt && opts.authority) {
    try {
      await ctx.subagents.interrupt(existing.current_session_id, opts.authority);
      interrupted = true;
    } catch (e) {
      ctx.logger?.warn?.(`member-service.leaveRun: interrupt failed for ${memberId}: ${e?.message ?? e}`);
    }
  }
  const updated = {
    ...existing,
    state: 'terminated',
    left_at: new Date().toISOString(),
    ...(opts.reason ? { leave_reason: opts.reason } : {}),
  };
  await writeJsonFile(sessionPath, updated);
  await appendLog('dispatch-log', runId, {
    id: newDispatchId(runId),
    timestamp: new Date().toISOString(),
    from: 'DSH',
    to: memberId,
    kind: 'member-leave',
    task: opts.reason ? `left run: ${opts.reason}` : 'left run',
    child_id: existing.current_session_id,
    interrupted,
  });
  return { state: 'terminated', interrupted };
}

/**
 * For tests only: reset the in-process dispatch id counter. Not part
 * of the public API.
 */
export function _resetForTests() {
  _dispatchSeq = 0;
}

// Silence unused-import warning for writeFile (kept available for future
// non-JSON writers); JSON writes go through writeJsonFile.
void writeFile;
