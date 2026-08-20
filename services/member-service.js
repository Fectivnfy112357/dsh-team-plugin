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
 * v2.0 #1 #2nd-batch (this revision):
 *   - `sendMessage` / `dispatch` / `wake` / `triggerSelfHandoff` — wrap
 *     `ctx.subagents.followup` for A2A / dispatch / system-wake paths,
 *     and chain-spawn a new continuable child for self-handoff.
 *     These complete the `MemberService` surface so the 2.0 flow engine
 *     can drive real subagents (the rewiring itself is a follow-up).
 *
 * @module dsh-team-plugin/member-service
 */
import { existsSync } from 'node:fs';
import { readFile, readFile as _readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths, sessionDir, ensureDir } from './paths.js';
import { writeJsonFile, appendLog } from './log-writer.js';
import { getAdapter, listAdapterIds } from './adapters.js';
import { send as messageSend } from './message-service.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Validate the id format. Same regex as role-service / team-template-service.
 * @param {string} id
 */
function validateId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('member-service: id is required');
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`member-service: id "${id}" must match ${ID_PATTERN}`);
  }
  return id;
}

/**
 * Validate a Member object's structural shape. The role_id must
 * reference a known role on disk (the service scans the global roles
 * dir). cli_options_override is an object (may be empty). metadata is
 * an object (may be empty).
 * @param {unknown} member
 * @returns {Promise<Member>}
 */
async function validateMember(member) {
  if (!member || typeof member !== 'object') {
    throw new Error('member-service: member must be an object');
  }
  const m = /** @type {Record<string, unknown>} */ (member);
  if (typeof m.id !== 'string' || m.id.length === 0) {
    throw new Error('member-service: id is required');
  }
  validateId(m.id);
  if (typeof m.role_id !== 'string' || m.role_id.length === 0) {
    throw new Error(`member-service: member ${m.id} role_id is required`);
  }
  if (typeof m.display_name !== 'string' || m.display_name.length === 0) {
    throw new Error(`member-service: member ${m.id} display_name is required`);
  }
  if (typeof m.persona !== 'string') {
    throw new Error(`member-service: member ${m.id} persona must be a string`);
  }
  if (typeof m.adapter !== 'string' || !_ADAPTER_IDS_FOR_VALIDATE.has(m.adapter)) {
    throw new Error(
      `member-service: member ${m.id} adapter "${String(m.adapter)}" must be one of ${[..._ADAPTER_IDS_FOR_VALIDATE].join(', ')}`,
    );
  }
  const co = m.cli_options_override;
  if (co != null && (typeof co !== 'object' || Array.isArray(co))) {
    throw new Error(`member-service: member ${m.id} cli_options_override must be an object`);
  }
  const md = m.metadata;
  if (md != null && (typeof md !== 'object' || Array.isArray(md))) {
    throw new Error(`member-service: member ${m.id} metadata must be an object`);
  }
  // Cross-reference: the role_id must exist (defensive — the snapshot
  // embedded in meta.json takes the role payload at start time, so an
  // existing role is required for the member to be instantiable).
  const { get: getRole } = await import('./role-service.js');
  const role = await getRole(m.role_id);
  if (!role) {
    throw new Error(
      `member-service: member ${m.id} role_id "${m.role_id}" does not exist; create the role first`,
    );
  }
  return /** @type {Member} */ ({
    id: m.id,
    role_id: m.role_id,
    display_name: m.display_name,
    persona: m.persona,
    adapter: /** @type {Member['adapter']} */ (m.adapter),
    cli_options_override: co ? { ...co } : {},
    metadata: md ? { ...md } : {},
  });
}

/** @type {Set<string>} */
const _ADAPTER_IDS_FOR_VALIDATE = new Set(listAdapterIds());

/**
 * Persist a Member to disk. Validates shape + cross-references the
 * role_id. Refuses to overwrite an existing file.
 * @param {Member | unknown} member
 * @returns {Promise<Member>}
 */
export async function create(member) {
  const normalised = await validateMember(member);
  const path = join(getTeamPaths().membersDir, `${normalised.id}.json`);
  if (existsSync(path)) {
    throw new Error(`member-service.create: member "${normalised.id}" already exists`);
  }
  ensureDir(getTeamPaths().membersDir);
  await writeJsonFile(path, normalised);
  return normalised;
}

/**
 * Update an existing Member. The id is immutable. cli_options_override
 * and metadata are replaced (not merged) by the patch.
 * @param {string} id
 * @param {Partial<Member>} patch
 * @returns {Promise<Member>}
 */
export async function update(id, patch) {
  validateId(id);
  if (!patch || typeof patch !== 'object') {
    throw new Error(`member-service.update: patch is required for member "${id}"`);
  }
  if (patch.id !== undefined && patch.id !== id) {
    throw new Error(
      `member-service.update: member id is immutable ("${id}" -> "${patch.id}")`,
    );
  }
  const cur = await get(id);
  if (!cur) {
    throw new Error(`member-service.update: member "${id}" not found`);
  }
  const next = await validateMember({ ...cur, ...patch, id });
  const path = join(getTeamPaths().membersDir, `${id}.json`);
  await writeJsonFile(path, next);
  return next;
}

/**
 * Delete a Member. Refuses when any TeamTemplate references this id
 * (template.members[].member_id) or when any in-flight run has
 * `meta.json.members[].member_id` matching this id.
 *
 * @param {string} id
 * @returns {Promise<{ deleted: boolean, refs: number, refSources: string[] }>}
 */
export async function remove(id) {
  validateId(id);
  const cur = await get(id);
  if (!cur) return { deleted: false, refs: 0, refSources: [] };
  const refSources = await findReferencesToMember(id);
  if (refSources.length > 0) {
    return { deleted: false, refs: refSources.length, refSources };
  }
  const path = join(getTeamPaths().membersDir, `${id}.json`);
  try {
    await unlink(path);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  return { deleted: true, refs: 0, refSources: [] };
}

/**
 * Walk team-templates and team-runs to find anything that references
 * the given member id. Returns a list of human-readable source
 * descriptors (e.g. `template:default-team`, `run:run-abc-1234`).
 * @param {string} memberId
 * @returns {Promise<string[]>}
 */
async function findReferencesToMember(memberId) {
  const refs = [];
  try {
    const { list: listTemplates } = await import('./team-template-service.js');
    const templates = await listTemplates();
    for (const t of templates) {
      if (Array.isArray(t?.members) && t.members.some((m) => m?.member_id === memberId)) {
        refs.push(`template:${t.id}`);
      }
    }
  } catch { /* template scan is best-effort */ }
  try {
    const { list: listRuns } = await import('./team-service.js');
    const runs = await listRuns({});
    for (const r of runs) {
      if (Array.isArray(r?.members) && r.members.some((m) => m?.member_id === memberId)) {
        refs.push(`run:${r.id}`);
      }
    }
  } catch { /* run scan is best-effort */ }
  return refs;
}

/** Test-only reset. Currently a no-op. (The dispatch-seq reset lives at the bottom of this file.) */
// Note: a real `_resetForTests` exists below (resets the dispatch id
// counter for tests). We don't shadow it here.

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

/** @typedef {{
 *   to: string,                              // recipient member id (or 'broadcast')
 *   topic: string,                            // Q-M4 structured header
 *   intent: 'discuss'|'notify'|'confirm'|'request-info',
 *   payload?: unknown,                        // DSH 不读 (architecture §4.3)
 *   inReplyTo?: string,                       // optional msg id
 *   kind?: 'message'|'system-wake',           // default 'message'
 * }} SendMessageBody
 */

/** @typedef {{
 *   runId: string,
 *   fromMemberId: string,
 *   parent?: any,        // DSH scheduler's live Agent (required in production)
 *   signal?: AbortSignal,
 * }} SendMessageOptions
 */

/** @typedef {{
 *   task: string,
 *   contextRefs?: string[],        // upstream artifact ids
 *   parent?: any,                   // DSH scheduler's live Agent
 *   signal?: AbortSignal,
 *   promptOverride?: Array<{ type: string, [k: string]: unknown }>,
 * }} DispatchOptions
 */

/** @typedef {{
 *   reason?: string,                // default 'context-overflow'
 *   parent?: any,                    // DSH scheduler's live Agent (drives startContinuable)
 *   signal?: AbortSignal,
 *   promptOverride?: Array<{ type: string, [k: string]: unknown }>,  // composed [persona] + [handoff] + [task]
 *   handoffFile?: string,           // filename under sessionDir (e.g. 'handoff-2.md'); appended to handoff_files
 * }} TriggerSelfHandoffOptions
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
 * Send an A2A-style message from a member to a (single) recipient. Wraps
 * `MessageService.send` (which writes `a2a-message-log.jsonl` and delivers
 * the id to the recipient's inbox) and, when the recipient has a live
 * continuable child, follows up with a lightweight ACP prompt that nudges
 * the recipient to read its inbox (per architecture §9.4: DSH does not
 * read payload content, only the header; the followup text is the
 * "you have a new message" hint).
 *
 * Idempotency: a duplicate `sendMessage` for the same `(fromMemberId, to,
 * topic, inReplyTo)` within the same wall clock will produce a fresh
 * `a2a-message-log` row (MessageService always appends); the receiver
 * dedup happens on the LLM side via the inbox's `processed` list.
 *
 * @param {any} ctx
 * @param {string} runId
 * @param {string} fromMemberId
 * @param {SendMessageBody} msg
 * @param {SendMessageOptions} [opts]
 * @returns {Promise<{ entry: any, followupMessageId?: string }>}
 */
export async function sendMessage(ctx, runId, fromMemberId, msg, opts = {}) {
  if (!ctx) throw new Error('member-service.sendMessage: ctx is required');
  if (!runId) throw new Error('member-service.sendMessage: runId is required');
  if (!fromMemberId) throw new Error('member-service.sendMessage: fromMemberId is required');
  if (!msg?.to) throw new Error('member-service.sendMessage: msg.to is required');
  // 1. Persist via MessageService.send (a2a-log + inbox delivery).
  const entry = await messageSend({
    runId,
    from: fromMemberId,
    to: msg.to,
    topic: msg.topic,
    intent: msg.intent,
    payload: msg.payload,
    inReplyTo: msg.inReplyTo,
    kind: msg.kind === 'system-wake' ? 'system-wake' : 'message',
  });
  // 2. Follow up on the live child when the recipient is a single joined
  //    member. 'broadcast' recipients are not poked individually — each
  //    member's next LLM turn will see the inbox row.
  if (entry.to === 'broadcast') {
    return { entry };
  }
  if (typeof ctx.subagents?.followup !== 'function' || !opts.parent) {
    return { entry };
  }
  const recipient = await readSessionState(runId, msg.to);
  if (!recipient || recipient.state !== 'running' || !recipient.current_session_id) {
    return { entry };
  }
  const content = [
    {
      type: 'text',
      text: `[A2A message from ${fromMemberId}] topic=${msg.topic} intent=${msg.intent} msg_id=${entry.id}. Check your inbox for the full message.`,
    },
  ];
  const followupMessageId = await ctx.subagents.followup(
    opts.parent,
    recipient.current_session_id,
    content,
    { signal: opts.signal ?? new AbortController().signal },
  );
  return { entry, followupMessageId };
}

/**
 * Dispatch a task from the DSH scheduler to a member. If the member has
 * not yet joined the run, `joinRun` is called first (so `dispatch` is the
 * canonical "issue a task" verb, matching `team.complete_step` etc.).
 * After the member is running, `ctx.subagents.followup` is invoked with
 * the composed prompt (override-able via `opts.promptOverride`).
 *
 * The dispatch is recorded in `dispatch-log.jsonl` (per architecture
 * §4.3 single-writer contract: DSH is the only writer; this service
 * runs in the DSH process).
 *
 * @param {any} ctx
 * @param {string} runId
 * @param {string} toMemberId
 * @param {DispatchOptions} opts
 * @returns {Promise<{ dispatchId: string, childId: string, messageId: string, joinedNow: boolean }>}
 */
export async function dispatch(ctx, runId, toMemberId, opts = {}) {
  if (!ctx) throw new Error('member-service.dispatch: ctx is required');
  if (!runId) throw new Error('member-service.dispatch: runId is required');
  if (!toMemberId) throw new Error('member-service.dispatch: toMemberId is required');
  if (typeof opts.task !== 'string' || opts.task.length === 0) {
    throw new Error('member-service.dispatch: opts.task is required');
  }
  if (typeof ctx.subagents?.followup !== 'function') {
    throw new Error('member-service.dispatch: ctx.subagents.followup is required');
  }
  // 1. Ensure the member is running; auto-join if not (covers the
  //    "first dispatch after assemble" case without a separate join call).
  const existing = await readSessionState(runId, toMemberId);
  let joinedNow = false;
  let childId;
  if (!existing || existing.state !== 'running' || !existing.current_session_id) {
    const join = await joinRun(ctx, runId, toMemberId, {
      ...(opts.parent ? { parent: opts.parent } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    childId = join.childId;
    joinedNow = true;
  } else {
    childId = existing.current_session_id;
  }
  // 2. Compose the prompt. Default: "[dispatch] <task>\n\ncontext_refs: ..."
  //    Caller can fully override via opts.promptOverride.
  const prompt = opts.promptOverride ?? composeDispatchPrompt(opts);
  const messageId = await ctx.subagents.followup(
    opts.parent,
    childId,
    prompt,
    { signal: opts.signal ?? new AbortController().signal },
  );
  // 3. Append dispatch-log row (single-writer contract).
  const dispatchId = newDispatchId(runId);
  await appendLog('dispatch-log', runId, {
    id: dispatchId,
    timestamp: new Date().toISOString(),
    from: 'scheduler',
    to: toMemberId,
    task: opts.task,
    context_refs: opts.contextRefs ?? [],
    child_id: childId,
    message_id: messageId,
    issued_at: new Date().toISOString(),
    completed_at: null,
    produced_artifact_ids: [],
    joined_now: joinedNow,
  });
  return { dispatchId, childId, messageId, joinedNow };
}

/**
 * Force a wake (no dedup) to a member's live child. Used by callers that
 * need to nudge the recipient's LLM to check its inbox — e.g. a freshly
 * written `a2a-message-log` row that bypasses the wake-dedup window, or
 * an explicit "kick the member" from the scheduler. Compared to the
 * dedup'd wake inside `MessageService.send`, this method:
 *   - has no `WAKE_DEDUP_SECONDS` window
 *   - bypasses the in-memory `_lastWake` map
 *
 * @param {any} ctx
 * @param {string} runId
 * @param {string} toMemberId
 * @param {{ parent?: any, signal?: AbortSignal, reason?: string }} [opts]
 * @returns {Promise<{ dispatched: boolean, messageId?: string }>}
 */
export async function wake(ctx, runId, toMemberId, opts = {}) {
  if (!ctx) throw new Error('member-service.wake: ctx is required');
  if (!runId) throw new Error('member-service.wake: runId is required');
  if (!toMemberId) throw new Error('member-service.wake: toMemberId is required');
  if (typeof ctx.subagents?.followup !== 'function' || !opts.parent) {
    return { dispatched: false };
  }
  const recipient = await readSessionState(runId, toMemberId);
  if (!recipient || recipient.state !== 'running' || !recipient.current_session_id) {
    return { dispatched: false };
  }
  const content = [
    {
      type: 'text',
      text: `[system-wake${opts.reason ? `: ${opts.reason}` : ''}] check your inbox and process any pending messages.`,
    },
  ];
  const messageId = await ctx.subagents.followup(
    opts.parent,
    recipient.current_session_id,
    content,
    { signal: opts.signal ?? new AbortController().signal },
  );
  return { dispatched: true, messageId };
}

/**
 * Trigger a self-handoff: interrupt the current child, spawn a new
 * continuable child, and chain the new id onto `session-state.session_chain`.
 *
 * Per architecture §9.3 + requirements §9.3: the member writes its own
 * `handoff-<n>.md` (the "context overflow" side of the contract; not the
 * service's job). This method:
 *   1. Reads the current `session-state.json` (must be `state=running`).
 *   2. Best-effort interrupts the old child (so its ACP session is closed
 *      and any in-flight work stops).
 *   3. Starts a new continuable child with `opts.promptOverride` —
 *      expected to be the caller-composed "[persona] + [handoff doc] + [task]".
 *   4. Updates `session-state.json` with the new `current_session_id`,
 *      appends to `session_chain` and `handoff_files`, and increments
 *      `self_handoff_count`.
 *   5. Appends a `kind=member-self-handoff` row to `dispatch-log.jsonl`.
 *
 * The old session is **not** marked `terminated` in `session-state.json` —
 * it stays `running` because the member is conceptually the same entity,
 * just continuing in a new ACP session (per requirements §9.2: "session
 * 不重建直到 Run 终态"). The chain is the source of truth for the
 * history of child sessions.
 *
 * @param {any} ctx
 * @param {string} runId
 * @param {string} memberId
 * @param {TriggerSelfHandoffOptions} [opts]
 * @returns {Promise<{ newChildId: string, messageId: string, handoffCount: number }>}
 */
export async function triggerSelfHandoff(ctx, runId, memberId, opts = {}) {
  if (!ctx) throw new Error('member-service.triggerSelfHandoff: ctx is required');
  if (!runId) throw new Error('member-service.triggerSelfHandoff: runId is required');
  if (!memberId) throw new Error('member-service.triggerSelfHandoff: memberId is required');
  if (typeof ctx.subagents?.startContinuable !== 'function') {
    throw new Error('member-service.triggerSelfHandoff: ctx.subagents.startContinuable is required');
  }
  if (typeof ctx.subagents?.interrupt !== 'function') {
    throw new Error('member-service.triggerSelfHandoff: ctx.subagents.interrupt is required');
  }
  const existing = await readSessionState(runId, memberId);
  if (!existing || existing.state !== 'running' || !existing.current_session_id) {
    throw new Error(`member-service.triggerSelfHandoff: member ${memberId} is not running in run ${runId} (state=${existing?.state})`);
  }
  const member = await get(memberId);
  if (!member) {
    throw new Error(`member-service.triggerSelfHandoff: unknown member "${memberId}"`);
  }
  const adapterId = member.adapter;
  if (!_ADAPTER_IDS.has(adapterId)) {
    throw new Error(`member-service.triggerSelfHandoff: member ${memberId} has unknown adapter "${adapterId}"`);
  }
  const adapter = getAdapter(adapterId);
  // 1. Interrupt the old child (best-effort). The authority is optional —
  //    the scheduler (parent) holds the durable handle.
  let interrupted = false;
  try {
    await ctx.subagents.interrupt(existing.current_session_id, opts.parent ?? { kind: 'ancestor', agent: null });
    interrupted = true;
  } catch (e) {
    ctx.logger?.warn?.(`member-service.triggerSelfHandoff: interrupt failed for ${memberId}: ${e?.message ?? e}`);
  }
  // 2. Start the new child. The label keeps the same `<member>-<run>` root
  //    so the continuation manager treats this as a continuation; the
  //    child id is the new durable handle.
  const label = `${memberId}-${runId}`;
  const startSpec = {
    provider: adapter.provider,
    label,
    request: {
      ...(opts.parent ? { parent: opts.parent } : {}),
      prompt: opts.promptOverride ?? [
        { type: 'text', text: `[self-handoff for ${memberId}] (no prompt override supplied; the caller should pass [persona] + [handoff doc] + [task] via opts.promptOverride)` },
      ],
      ...(opts.persona || member.persona ? { persona: opts.persona ?? member.persona } : {}),
    },
    signal: opts.signal ?? new AbortController().signal,
  };
  const result = await ctx.subagents.startContinuable(startSpec);
  if (!result?.childId) {
    throw new Error(`member-service.triggerSelfHandoff: startContinuable returned no childId (provider=${adapter.provider})`);
  }
  // 3. Update session-state.json: append the new child to the chain, push
  //    the handoff filename (if supplied), bump self_handoff_count.
  const sessionPath = join(sessionDir(runId, memberId), 'session-state.json');
  const chain = Array.isArray(existing.session_chain) ? existing.session_chain.slice() : [];
  if (!chain.includes(result.childId)) chain.push(result.childId);
  const handoffFiles = Array.isArray(existing.handoff_files) ? existing.handoff_files.slice() : [];
  if (opts.handoffFile) {
    if (!handoffFiles.includes(opts.handoffFile)) handoffFiles.push(opts.handoffFile);
  }
  const newCount = (existing.self_handoff_count ?? 0) + 1;
  const updated = {
    ...existing,
    current_session_id: result.childId,
    session_chain: chain,
    handoff_files: handoffFiles,
    self_handoff_count: newCount,
    state: 'running',
    provider: adapter.provider,
    adapter: adapterId,
    child_id: result.childId,
    message_id: result.messageId,
    last_handoff_at: new Date().toISOString(),
    ...(opts.handoffFile ? { last_handoff_file: opts.handoffFile } : {}),
  };
  await writeJsonFile(sessionPath, updated);
  // 4. Record the self-handoff in dispatch-log (single-writer contract).
  await appendLog('dispatch-log', runId, {
    id: newDispatchId(runId),
    timestamp: new Date().toISOString(),
    from: 'DSH',
    to: memberId,
    kind: 'member-self-handoff',
    task: opts.reason ? `self-handoff: ${opts.reason}` : 'self-handoff',
    child_id_old: existing.current_session_id,
    child_id: result.childId,
    message_id: result.messageId,
    provider: adapter.provider,
    handoff_file: opts.handoffFile ?? null,
    self_handoff_count: newCount,
    interrupted,
  });
  return { newChildId: result.childId, messageId: result.messageId, handoffCount: newCount };
}

/**
 * Build the default followup prompt for `dispatch`. Kept private to the
 * service so the shape is easy to evolve without touching callers.
 * @param {DispatchOptions} opts
 */
function composeDispatchPrompt(opts) {
  const refs = (opts.contextRefs ?? []).map((r) => `- ${r}`).join('\n');
  return [
    {
      type: 'text',
      text: [
        '[dispatch]',
        `task: ${opts.task}`,
        opts.contextRefs?.length ? `\ncontext_refs:\n${refs}` : '',
      ].filter(Boolean).join('\n'),
    },
  ];
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
