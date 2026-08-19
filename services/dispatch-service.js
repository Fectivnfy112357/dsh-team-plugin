/**
 * dispatch-service.js — DSH-routed dispatch (派活 + 终态标记).
 *
 * Per architecture.md §2.4 + §4.4: the only writer of `dispatch-log.jsonl`.
 * `handoff-log.jsonl` is also written here because in the v1.0 simplified
 * shape the dispatcher and the handoff router are the same role (DSH acts
 * as the routing proxy between members; members don't write directly).
 *
 * v1.0 scope: append dispatch records; full followup / wake semantics
 * (i.e. the actual `ctx.subagents.followup(...)` call) is in P1+ once
 * MemberService.joinRun lands.
 *
 * @module dsh-team-plugin/dispatch-service
 */
import { appendLog } from './log-writer.js';

/** @typedef {{
 *   id: string,
 *   from: 'scheduler',
 *   to: string,
 *   task: string,
 *   context_refs: string[],
 *   issued_at: string,
 *   completed_at?: string,
 *   produced_artifact_ids: string[],
 *   run_id: string,
 *   seq: number,
 *   terminal?: 'completed'|'failed'|'interrupted',
 * }} DispatchLogEntry
 */

/**
 * Issue a new dispatch. Returns the created entry (caller persists a
 * `seq` if there is one running counter, else trusts monotonic insertion).
 * @param {Omit<DispatchLogEntry, 'id'|'issued_at'|'produced_artifact_ids'> & { seq: number }} entry
 */
export async function dispatch(entry) {
  const id = `d-${entry.run_id}-${entry.seq}-${Math.random().toString(36).slice(2, 6)}`;
  const full = {
    id,
    from: 'scheduler',
    issued_at: new Date().toISOString(),
    produced_artifact_ids: [],
    ...entry,
  };
  await appendLog('dispatch-log', entry.run_id, full);
  return full;
}

/**
 * Mark a dispatch with a terminal state.
 * @param {string} runId
 * @param {string} dispatchId
 * @param {'completed'|'failed'|'interrupted'} terminal
 * @param {{ produced_artifact_ids?: string[] }} [extra]
 */
export async function markTerminal(runId, dispatchId, terminal, extra = {}) {
  await appendLog('dispatch-log', runId, {
    id: dispatchId,
    terminal,
    terminal_at: new Date().toISOString(),
    ...extra,
  });
}

/**
 * Record a handoff between members (or a member → DSH-routing). DSH acts
 * as the routing proxy; members do not write handoff-log directly.
 * @param {{
 *   run_id: string,
 *   from: string,
 *   to: string,
 *   task: string,
 *   artifacts?: string[],
 *   context?: string,
 *   reason?: string,
 *   seq: number,
 * }} entry
 */
export async function handoff(entry) {
  const id = `h-${entry.run_id}-${entry.seq}-${Math.random().toString(36).slice(2, 6)}`;
  await appendLog('handoff-log', entry.run_id, {
    id,
    timestamp: new Date().toISOString(),
    artifacts: [],
    ...entry,
  });
}
