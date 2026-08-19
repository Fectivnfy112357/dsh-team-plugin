/**
 * message-service.js — A2A-style messages between Members (or system-wake).
 *
 * Per architecture.md §4.3 + requirements.md §2.6 / §9.4:
 *   - 唯一写入者 = DSH Team Service;成员不直接写
 *   - send 写 a2a-message-log.jsonl + 投递 inbox + wake(to)
 *   - DSH 不读 payload 内容（只看 header topic / intent / kind）
 *   - wake 去重:T 秒内同目标不重复唤醒
 *
 * v1.0 scope:
 *   - 写 a2a-message-log
 *   - 更新 receiver 的 session-state.json inbox (pending / processed)
 *   - wake 去重:in-memory map per (runId, toMemberId),TTL = WAKE_DEDUP_SECONDS
 *
 * @module dsh-team-plugin/message-service
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { appendLog } from './log-writer.js';
import { sessionDir } from './paths.js';

/** @typedef {{
 *   id: string,
 *   from: string,
 *   to: string | 'broadcast',
 *   topic: string,
 *   intent: string,
 *   payload: unknown,
 *   inReplyTo?: string,
 *   run_id: string,
 *   timestamp: string,
 *   delivered_to_inbox_at?: string,
 *   kind: 'message'|'system-wake',
 * }} A2AMessageLogEntry
 */

/** @typedef {{
 *   runId: string,
 *   from: string,
 *   to: string | 'broadcast',
 *   topic: string,
 *   intent: string,
 *   payload?: unknown,
 *   inReplyTo?: string,
 *   kind?: 'message'|'system-wake',
 * }} SendRequest
 */

/** Wake dedup window (seconds). Per §9.4 第六轮收口. */
const WAKE_DEDUP_SECONDS = 5;

/** @type {Map<string, number>} keyed by `${runId}::${to}`;value = last wake epoch ms. */
const _lastWake = new Map();

/** @returns {string} */
function newMsgId(runId) {
  return `m-${runId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Read the current session-state.json for a member. Returns undefined if
 * missing or unreadable (in which case we treat the inbox as empty).
 * @param {string} runId
 * @param {string} memberId
 */
async function readSessionState(runId, memberId) {
  const path = join(sessionDir(runId, memberId), 'session-state.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(await readFile(path, 'utf-8'));
  } catch {
    return undefined;
  }
}

/**
 * Append a message id to the receiver's inbox. If `to` is 'broadcast' we
 * fan out to all members in meta.json (best-effort — members joined
 * after the broadcast are not notified; that's a v2.0 design point).
 * @param {A2AMessageLogEntry} entry
 */
async function deliverToInbox(entry) {
  const deliveredAt = new Date().toISOString();
  entry.delivered_to_inbox_at = deliveredAt;
  if (entry.to === 'broadcast') {
    // Fan-out: read meta.json members, append to each
    const metaPath = join(sessionDir(entry.run_id, '_'), '..', 'meta.json');
    // meta.json lives one level above sessions/<member>/, i.e. at runDir(meta.id).
    // We compute it from the message id; safer: read it from a known location.
    const { readMeta } = await import('./team-service.js');
    const meta = await readMeta(entry.run_id);
    if (!meta) return;
    for (const m of meta.members) {
      await pushInbox(entry.run_id, m.member_id, entry.id);
    }
    return;
  }
  await pushInbox(entry.run_id, entry.to, entry.id);
}

/**
 * Append a message id to one member's inbox (pending list), deduplicating
 * by id. Writes the full session-state.json back.
 */
async function pushInbox(runId, memberId, msgId) {
  const path = join(sessionDir(runId, memberId), 'session-state.json');
  let state = await readSessionState(runId, memberId);
  if (!state) {
    state = {
      current_session_id: null,
      session_chain: [],
      handoff_files: [],
      inbox: { pending: [], processed: [] },
      state: 'pending',
      self_handoff_count: 0,
    };
  }
  const pending = state.inbox?.pending ?? [];
  if (!pending.includes(msgId)) pending.push(msgId);
  state.inbox = { pending, processed: state.inbox?.processed ?? [] };
  await writeFile(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

/**
 * Should we actually fire a wake for this (runId, to) target right now?
 * Wake dedup: at most one wake per target per WAKE_DEDUP_SECONDS window.
 * @param {string} runId
 * @param {string} to
 * @returns {boolean} true if the wake should fire
 */
export function shouldWake(runId, to) {
  const key = `${runId}::${to}`;
  const last = _lastWake.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < WAKE_DEDUP_SECONDS * 1000) {
    return false;
  }
  _lastWake.set(key, now);
  return true;
}

/**
 * Send an A2A-style message. Writes a2a-message-log, delivers to inbox,
 * and (if eligible) triggers a wake.
 *
 * DSH does not read `payload` (architecture §4.3 / §2.6). The payload is
 * opaque to the dispatcher; only the receiver's LLM reads it via the inbox
 * + the followup prompt that includes the message summary.
 *
 * @param {SendRequest} req
 * @returns {Promise<A2AMessageLogEntry>}
 */
export async function send(req) {
  if (!req?.runId) throw new Error('message-service.send: runId is required');
  if (!req?.from) throw new Error('message-service.send: from is required');
  if (!req?.to) throw new Error('message-service.send: to is required');
  if (typeof req.topic !== 'string' || req.topic.length === 0) {
    throw new Error('message-service.send: topic is required');
  }
  if (typeof req.intent !== 'string' || req.intent.length === 0) {
    throw new Error('message-service.send: intent is required');
  }
  const entry = {
    id: newMsgId(req.runId),
    from: req.from,
    to: req.to,
    topic: req.topic,
    intent: req.intent,
    payload: req.payload ?? null,
    ...(req.inReplyTo ? { in_reply_to: req.inReplyTo } : {}),
    run_id: req.runId,
    timestamp: new Date().toISOString(),
    kind: req.kind === 'system-wake' ? 'system-wake' : 'message',
  };
  await appendLog('a2a-message-log', req.runId, entry);
  await deliverToInbox(entry);
  // Wake the target (if it has an inbox delivery). For 'broadcast' the
  // shouldWake is per-target; for direct sends it's a single check.
  if (entry.to !== 'broadcast' && shouldWake(req.runId, entry.to)) {
    // Real wake = subagent.followup({ handle, prompt: 'check inbox' }).
    // v1.0 doesn't drive the subagent runtime yet; the inbox is what
    // matters — the next dispatch / followup reads it.
  }
  return entry;
}

/**
 * For tests only: clear the wake dedup map.
 */
export function _resetForTests() {
  _lastWake.clear();
}
