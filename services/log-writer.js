/**
 * log-writer.js — append-only writer for the 5 coordination logs.
 *
 * Per architecture.md §5.3 (the "single-writer" promise):
 *   - dispatch-log.jsonl / handoff-log.jsonl / a2a-message-log.jsonl
 *   - user-intervention-log.jsonl / state-history.jsonl
 *
 * All five live under `<team-runs>/<run-id>/`. They are append-only and the
 * plugin is the **only** writer inside the DSH process — member ACP processes
 * must not touch them (architecture §2.4 / §9.3 lock this).
 *
 * Concurrency model: one async mutex per (log-name, run-id) pair serialises
 * all appends within this DSH process. FSLock is unnecessary within a single
 * process; cross-process safety is explicitly out of scope for v1.0
 * (architecture §11.1: "1.0 单实例").
 *
 * @module dsh-team-plugin/log-writer
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runDir } from './paths.js';

/** @typedef {'dispatch-log'|'handoff-log'|'a2a-message-log'|'user-intervention-log'|'state-history'} LogName */

/** @type {Map<string, Promise<void>>} */
const _chains = new Map();

/**
 * Serialise a unit of work on a (log, run) key. Returns a promise that
 * resolves when this and every earlier queued unit on the same key have
 * settled. The promise chain itself is never broken — a throwing unit still
 * releases the next unit's turn so the chain doesn't deadlock.
 * @param {string} key
 * @param {() => Promise<void>} unit
 * @returns {Promise<void>}
 */
function enqueue(key, unit) {
  const prev = _chains.get(key) ?? Promise.resolve();
  const next = prev.then(unit, unit);
  // swallow rejections for chain continuity; the caller still sees them
  _chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

/**
 * Append one JSONL line to a coordination log. Creates the parent directory
 * lazily. Failures bubble up to the caller; on error we DO release the chain
 * (enqueue above swallows the rejection) so subsequent appends aren't
 * permanently blocked.
 * @param {LogName} log - which of the 5 coordination logs
 * @param {string} runId - run whose directory the log lives in
 * @param {Record<string, unknown>} entry - JSON-serialisable object
 * @returns {Promise<void>}
 */
export async function appendLog(log, runId, entry) {
  if (!runId || typeof runId !== 'string') {
    throw new Error(`log-writer: runId must be a non-empty string, got ${runId}`);
  }
  if (!entry || typeof entry !== 'object') {
    throw new Error(`log-writer: entry must be a JSON object, got ${entry}`);
  }
  const path = join(runDir(runId), `${log}.jsonl`);
  const line = JSON.stringify(entry) + '\n';
  const key = `${log}::${runId}`;
  return enqueue(key, async () => {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, line, 'utf-8');
  });
}

/**
 * Append to a meta.json-like location **outside** the coordination logs
 * (e.g. meta.json updates are written by the state machine, not the log
 * writer). Kept as a sibling helper because the write-after-state-history
 * ordering in the state machine is the most common pattern that needs both.
 *
 * This is intentionally NOT a jsonl append — meta.json is rewritten on every
 * state change. A future revision may switch to copy-on-write for crash
 * safety; v1.0 keeps the simple model (architecture §6.1: write history
 * first, then update meta).
 * @param {string} path - absolute path of the json file
 * @param {unknown} data - JSON-serialisable content
 * @returns {Promise<void>}
 */
export async function writeJsonFile(path, data) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}
