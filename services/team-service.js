/**
 * team-service.js — Team Run lifecycle + state machine.
 *
 * Implements the state machine from architecture.md §4.1 / §6.1, with
 * append-only state-history (write history FIRST, then meta.json) and
 * 启动对账 (reconcileOnBoot) on `host/boot`.
 *
 * v1.0 scope:
 *   - state transitions for the 8 states (pending / assembling / running /
 *     succeeded / failed / interrupted / aborted / archived) with the
 *     `degraded` flag as a meta.json modifier, not a state
 *   - start / abort / list / get / reconcileOnBoot
 *   - fan-out / pipeline / round-table are **out of scope** for v1.0; this
 *     service only manages the run envelope, not the flow engine. The flow
 *     engine will sit on top of this service in P1+ (architecture §4.7).
 *
 * @module dsh-team-plugin/team-service
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths, runDir, sessionDir } from './paths.js';
import { appendLog, writeJsonFile } from './log-writer.js';

/** @typedef {{
 *   id: string,
 *   state: 'pending'|'assembling'|'running'|'succeeded'|'failed'|'interrupted'|'aborted'|'archived',
 *   degraded_flag: boolean,
 *   flow: 'handoff-round-table'|'pipeline-with-feedback'|'fan-out-collect',
 *   flow_config: Record<string, unknown>,
 *   members: Array<{member_id: string, instance_alias: string, snapshot?: unknown}>,
 *   task_description: string,
 *   current_round: number,
 *   created_at: string,
 *   started_at?: string,
 *   ended_at?: string,
 *   template_id?: string,
 * }} TeamRunMeta
 */

/** @typedef {{
 *   taskDescription: string,
 *   flow: TeamRunMeta['flow'],
 *   flowConfig: Record<string, unknown>,
 *   members: Array<{member_id: string, instance_alias: string}>,
 *   templateId?: string,
 * }} StartTeamRunRequest
 */

/** Allowed transitions; missing transitions are illegal. */
const ALLOWED = /** @type {Record<TeamRunMeta['state'], Set<TeamRunMeta['state']>>} */ ({
  pending: new Set(['assembling', 'aborted', 'failed']),
  assembling: new Set(['running', 'failed', 'aborted', 'interrupted']),
  running: new Set(['succeeded', 'failed', 'aborted', 'interrupted']),
  succeeded: new Set(['archived']),
  failed: new Set(['archived']),
  interrupted: new Set(['assembling', 'aborted', 'archived']),
  aborted: new Set(['archived']),
  archived: new Set(),
});

/** PID of the DSH process that holds this run. Used by reconcileOnBoot. */
const HOLDER_PID = process.pid;

/**
 * Generate a run id. Format: `run-<timestamp>-<rand4>`. v1.0 has no
 * cross-Run uniqueness requirement stronger than this (architecture §11.2
 * OQ-3: cross-Run artifact id format is locked; run-id format is
 * implementation choice).
 * @returns {string}
 */
export function newRunId() {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `run-${ts}-${rnd}`;
}

/**
 * Make the initial meta.json for a fresh run. Snapshots are filled in by
 * MemberService before start() returns; this function only writes the
 * envelope.
 * @param {StartTeamRunRequest} req
 * @param {string} runId
 * @returns {TeamRunMeta}
 */
function makeInitialMeta(req, runId) {
  const now = new Date().toISOString();
  return {
    id: runId,
    state: 'pending',
    degraded_flag: false,
    flow: req.flow,
    flow_config: req.flowConfig ?? {},
    members: req.members.map((m) => ({ ...m })),
    task_description: req.taskDescription,
    current_round: 0,
    created_at: now,
    ...(req.templateId ? { template_id: req.templateId } : {}),
  };
}

/**
 * Persist the meta.json for a run. Caller is responsible for ensuring the
 * run directory exists (start() does this).
 * @param {string} runId
 * @param {TeamRunMeta} meta
 */
export async function writeMeta(runId, meta) {
  await writeJsonFile(join(runDir(runId), 'meta.json'), meta);
}

/**
 * Read meta.json. Returns undefined if the run doesn't exist.
 * @param {string} runId
 * @returns {Promise<TeamRunMeta | undefined>}
 */
export async function readMeta(runId) {
  const path = join(runDir(runId), 'meta.json');
  if (!existsSync(path)) return undefined;
  try {
    const text = await readFile(path, 'utf-8');
    return /** @type {TeamRunMeta} */ (JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Read the complete meta + state history for diagnostic display.
 * @param {string} runId
 */
export async function get(runId) {
  return readMeta(runId);
}

/**
 * Append a state-history record and then update meta.json's `state` field.
 * The order is load-bearing: history first, then meta. A crash between the
 * two leaves a run whose meta says state=X but whose history lists the
 * transition to X — recoverable on next reconcile.
 * @param {string} runId
 * @param {TeamRunMeta['state']} from
 * @param {TeamRunMeta['state']} to
 * @param {string} reason
 * @param {Partial<TeamRunMeta>} [metaPatch]
 */
export async function transition(runId, from, to, reason, metaPatch = {}) {
  if (!ALLOWED[from]?.has(to)) {
    throw new Error(
      `team-service: illegal transition ${from} -> ${to} (run=${runId})`,
    );
  }
  await appendLog('state-history', runId, {
    from_state: from,
    to_state: to,
    reason,
    timestamp: new Date().toISOString(),
  });
  const cur = await readMeta(runId);
  if (!cur) {
    throw new Error(`team-service: meta.json missing for run=${runId}`);
  }
  const next = { ...cur, ...metaPatch, state: to };
  if (to === 'running' && !cur.started_at) next.started_at = new Date().toISOString();
  if (['succeeded', 'failed', 'aborted', 'interrupted'].includes(to) && !cur.ended_at) {
    next.ended_at = new Date().toISOString();
  }
  await writeMeta(runId, next);
  return next;
}

/**
 * Create a fresh run. Snapshots are NOT captured here — the caller (start()
 * user flow) is expected to pass pre-snapshotted member metadata, or accept
 * that the run will be patched via MemberService.joinRun before assembling.
 *
 * v1.0 simplified semantics: start() creates the run envelope at state=pending
 * and immediately transitions to assembling. Member joining + flow engine
 * activation happen in P1+; for now this is enough to verify the data
 * layout, the state machine, and the write order.
 * @param {StartTeamRunRequest} req
 * @returns {Promise<TeamRunMeta>}
 */
export async function start(req) {
  if (!req?.taskDescription || typeof req.taskDescription !== 'string') {
    throw new Error('team-service.start: taskDescription is required');
  }
  if (!req?.flow || !['handoff-round-table', 'pipeline-with-feedback', 'fan-out-collect'].includes(req.flow)) {
    throw new Error(`team-service.start: invalid flow "${req.flow}"`);
  }
  if (!Array.isArray(req?.members) || req.members.length === 0) {
    throw new Error('team-service.start: members must be a non-empty array');
  }
  const runId = newRunId();
  const meta = makeInitialMeta(req, runId);
  await writeMeta(runId, meta);
  await appendLog('state-history', runId, {
    from_state: 'pending',
    to_state: 'pending',
    reason: 'run-created',
    timestamp: meta.created_at,
  });
  return meta;
}

/**
 * Abort a run from any non-terminal state. Independent terminal (D1-1,
 * architecture §8.4).
 * @param {string} runId
 * @param {string} reason
 */
export async function abort(runId, reason) {
  const cur = await readMeta(runId);
  if (!cur) throw new Error(`team-service.abort: run ${runId} not found`);
  if (ALLOWED[cur.state] && !ALLOWED[cur.state].has('aborted')) {
    throw new Error(`team-service.abort: cannot abort from state=${cur.state}`);
  }
  return transition(runId, cur.state, 'aborted', reason);
}

/**
 * List runs. v1.0 simply scans the project-level team-runs directory.
 * @param {{ state?: TeamRunMeta['state'], includeArchived?: boolean }} [opts]
 * @returns {Promise<TeamRunMeta[]>}
 */
export async function list(opts = {}) {
  const dir = getTeamPaths().teamRunsDir;
  if (!existsSync(dir)) return [];
  const { readdir, stat } = await import('node:fs/promises');
  const entries = await readdir(dir);
  const out = [];
  for (const entry of entries) {
    const sub = join(dir, entry);
    const st = await stat(sub);
    if (!st.isDirectory()) continue;
    const meta = await readMeta(entry);
    if (!meta) continue;
    if (opts.state && meta.state !== opts.state) continue;
    if (!opts.includeArchived && meta.state === 'archived') continue;
    out.push(meta);
  }
  return out.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

/**
 * Set the degraded flag on a running run (architecture §8.3). The flag is
 * a meta.json modifier, NOT a state transition — the run stays at
 * state=running and the flag records that ≥1 (non-all) member is
 * unrecoverable. The state machine will let the run proceed to
 * succeeded(partial) at the end if appropriate.
 * @param {string} runId
 * @param {string} reason
 */
export async function setDegraded(runId, reason) {
  const cur = await readMeta(runId);
  if (!cur) throw new Error(`team-service.setDegraded: run ${runId} not found`);
  if (cur.state !== 'running') {
    throw new Error(`team-service.setDegraded: run ${runId} is not running (state=${cur.state})`);
  }
  if (cur.degraded_flag) return cur; // idempotent
  // log the flag transition (no state change; reason captured for audit)
  await appendLog('state-history', runId, {
    from_state: 'running',
    to_state: 'running',
    reason: `degraded-flag-set:${reason}`,
    timestamp: new Date().toISOString(),
  });
  const next = { ...cur, degraded_flag: true };
  await writeMeta(runId, next);
  return next;
}

/**
 * Reconcile state on DSH host boot (architecture §6.2). Scans all runs at
 * state in {assembling, running} and marks them `interrupted` because the
 * holding process is no longer alive.
 *
 * **v1.0 single-instance assumption** (architecture §11.1): the host is the
 * only DSH process; the holder is `process.pid` captured at module load. If
 * the host forks or runs multiple instances, this becomes unsound and the
 * 2.0 leader-election path is required.
 *
 * For each run that flips to `interrupted`, this function also walks the
 * per-run `dispatch-log.jsonl` and marks every dispatch whose latest line
 * has no `terminal` field as `interrupted` (reason `process-killed`) —
 * requirements.md §9.6 / architecture.md §6.2: "在途 dispatch 统一标记
 * dispatch-interrupted". Half-baked artifacts are preserved (immutable
 * snapshot, §9.11.4); the dispatch record itself becomes the anchor for a
 * potential re-run injection (§9.12.4).
 *
 * @returns {Promise<{ interrupted: string[] }>}
 */
export async function reconcileOnBoot() {
  const live = await list({});
  const interrupted = [];
  for (const meta of live) {
    if (meta.state !== 'assembling' && meta.state !== 'running') continue;
    // Single-instance heuristic: if our pid is not the holder, mark
    // interrupted. For v1.0 we just check the meta.json for a holder pid
    // marker; if missing or different, treat as orphaned.
    const holder = await readHolderPid(meta.id);
    if (holder !== undefined && holder !== HOLDER_PID) {
      await transition(meta.id, meta.state, 'interrupted', 'process-killed');
      interrupted.push(meta.id);
      await markInFlightDispatchesInterrupted(meta.id);
    } else if (holder === undefined) {
      // No holder recorded (older meta.json); assume the previous DSH died
      // and mark interrupted. This is the conservative move.
      await transition(meta.id, meta.state, 'interrupted', 'process-killed');
      interrupted.push(meta.id);
      await markInFlightDispatchesInterrupted(meta.id);
    }
  }
  return { interrupted };
}

/**
 * Walk the per-run `dispatch-log.jsonl` and, for every dispatch whose latest
 * line still has no `terminal` field, append a `terminal: 'interrupted'`
 * marker via `DispatchService.markTerminal`. dispatch-log is append-only,
 * so the latest line for a given dispatch id is the source of truth (the
 * first line is the issue, any later line is a terminal marker).
 *
 * @param {string} runId
 */
async function markInFlightDispatchesInterrupted(runId) {
  const path = join(runDir(runId), 'dispatch-log.jsonl');
  if (!existsSync(path)) return;
  let text;
  try { text = await readFile(path, 'utf-8'); } catch { return; }
  /** @type {Map<string, {terminal?: string}>} */
  const latest = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (!row?.id) continue;
    latest.set(row.id, row);
  }
  const inFlight = [];
  for (const row of latest.values()) {
    if (!row.terminal) inFlight.push(row.id);
  }
  if (inFlight.length === 0) return;
  // Lazy import: dispatch-service does not import team-service, so the
  // static graph is one-way, but the lazy form makes the call site at
  // reconcileOnBoot read top-down.
  const { markTerminal } = await import('./dispatch-service.js');
  for (const dispatchId of inFlight) {
    await markTerminal(runId, dispatchId, 'interrupted', {
      reason: 'process-killed',
      terminal_at: new Date().toISOString(),
    });
  }
}

/** @param {string} runId */
async function readHolderPid(runId) {
  const path = join(runDir(runId), 'holder.pid');
  if (!existsSync(path)) return undefined;
  try {
    const txt = await readFile(path, 'utf-8');
    const n = parseInt(txt.trim(), 10);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Record the current DSH process as the run holder. Called right after
 * start() so reconcileOnBoot can detect orphaned runs.
 * @param {string} runId
 */
export async function markHolder(runId) {
  await writeJsonFile(join(runDir(runId), 'holder.pid'), String(HOLDER_PID));
  // Also pre-create the per-member session skeleton so MemberService has
  // somewhere to write when joinRun lands in P1.
  for (const m of (await readMeta(runId))?.members ?? []) {
    await writeJsonFile(
      join(sessionDir(runId, m.member_id), 'session-state.json'),
      {
        current_session_id: null,
        session_chain: [],
        handoff_files: [],
        inbox: { pending: [], processed: [] },
        state: 'pending',
        self_handoff_count: 0,
      },
    );
  }
}
