#!/usr/bin/env node
/**
 * smoke-test.mjs — exercise the service layer without a DSH runtime.
 *
 * The plugin's services are plain modules; we can import them in a node
 * process and drive the state machine end-to-end against a temp directory.
 *
 * Verifies:
 *   - paths.js resolves the project-level team-runs dir from DSH_PROJECT_DIR
 *   - log-writer.js serialises appends (writes are non-overlapping)
 *   - team-service.js: start → transition → abort, illegal-transition error
 *   - reconcileOnBoot marks an orphaned run as interrupted
 *
 * Usage: node scripts/smoke-test.mjs
 * Exit: 0 on success, 1 on failure.
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Repo root = parent of scripts/ (the file lives at <root>/scripts/smoke-test.mjs)
const root = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'dsh-team-smoke-'));
process.env.DSH_PROJECT_DIR = tmp;
process.env.DSH_HOME = join(tmp, 'home');

let pass = 0, fail = 0;
const ok = (msg) => { pass++; console.log('  \u2713 ' + msg); };
const bad = (msg) => { fail++; console.error('  \u2717 ' + msg); };

async function importService(rel) {
  return import(pathToFileURL(join(root, rel)).href);
}

try {
  // ---- paths.js ----
  console.log('[1/4] paths.js');
  const { resolveTeamPaths, runDir } = await importService('services/paths.js');
  const paths = resolveTeamPaths();
  paths.teamRunsDir === join(tmp, '.dsh', 'team-runs')
    ? ok('teamRunsDir = <DSH_PROJECT_DIR>/.dsh/team-runs')
    : bad(`teamRunsDir = ${paths.teamRunsDir}`);
  paths.globalRoot === join(tmp, 'home')
    ? ok('globalRoot = DSH_HOME')
    : bad(`globalRoot = ${paths.globalRoot}`);

  // ---- log-writer.js ----
  console.log('\n[2/4] log-writer.js');
  const { appendLog, writeJsonFile } = await importService('services/log-writer.js');
  // Pre-create run dir so appendLog can find it (service normally ensures this)
  const runId0 = 'smoke-pre';
  await writeJsonFile(join(paths.teamRunsDir, runId0, 'meta.json'), { id: runId0, state: 'pending' });
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      appendLog('dispatch-log', runId0, { id: `d${i}`, n: i }),
    ),
  );
  const lines = readFileSync(join(paths.teamRunsDir, runId0, 'dispatch-log.jsonl'), 'utf-8')
    .trim().split('\n');
  lines.length === 20 ? ok('20 appends → 20 lines') : bad(`expected 20 lines, got ${lines.length}`);
  // Verify all entries are valid JSON + have unique ids (proves no overwrite)
  const ids = new Set();
  let allValid = true;
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (ids.has(o.id)) { allValid = false; break; }
      ids.add(o.id);
    } catch { allValid = false; break; }
  }
  allValid ? ok('all 20 entries parse and have unique ids') : bad('overwrite or invalid JSON detected');

  // ---- team-service.js: happy path + illegal transition ----
  console.log('\n[3/4] team-service.js');
  const ts = await importService('services/team-service.js');
  const meta = await ts.start({
    taskDescription: 'smoke test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 3 },
    members: [{ member_id: 'brainstormer', instance_alias: 'brain' }],
  });
  const runId = meta.id;
  meta.state === 'pending' ? ok('start() → state=pending') : bad(`start() → state=${meta.state}`);
  ok(`runId = ${runId}`);
  await ts.markHolder(runId);
  existsSync(join(paths.teamRunsDir, runId, 'holder.pid'))
    ? ok('markHolder() wrote holder.pid')
    : bad('holder.pid missing');
  existsSync(join(paths.teamRunsDir, runId, 'sessions', 'brainstormer', 'session-state.json'))
    ? ok('markHolder() pre-created per-member session-state.json')
    : bad('per-member session-state.json missing');

  // legal transition: pending → assembling
  const m1 = await ts.transition(runId, 'pending', 'assembling', 'team-formed');
  m1.state === 'assembling' ? ok('pending → assembling') : bad(`got ${m1.state}`);

  // legal transition: assembling → running (note: started_at is set here)
  const m2 = await ts.transition(runId, 'assembling', 'running', 'first dispatch issued');
  m2.state === 'running' && typeof m2.started_at === 'string'
    ? ok('assembling → running (started_at set)')
    : bad(`state=${m2.state} started_at=${m2.started_at}`);

  // illegal transition: running → pending
  let illegalCaught = false;
  try {
    await ts.transition(runId, 'running', 'pending', 'should-fail');
  } catch (e) {
    illegalCaught = /illegal transition/.test(String(e.message));
  }
  illegalCaught ? ok('illegal transition throws') : bad('illegal transition did not throw');

  // abort path
  const aborted = await ts.abort(runId, 'smoke-test-cancel');
  aborted.state === 'aborted' && typeof aborted.ended_at === 'string'
    ? ok('running → aborted (ended_at set)')
    : bad(`state=${aborted.state} ended_at=${aborted.ended_at}`);

  // state-history should have 5 entries: pending, pending→assembling, →running, →aborted
  // (start() also writes an initial entry: from=pending, to=pending, reason=run-created)
  const hist = readFileSync(join(paths.teamRunsDir, runId, 'state-history.jsonl'), 'utf-8')
    .trim().split('\n').map((l) => JSON.parse(l));
  hist.length === 4
    ? ok(`state-history.jsonl has 4 entries`)
    : bad(`state-history.jsonl has ${hist.length} entries (expected 4)`);
  const histReasons = hist.map((h) => h.reason).join(',');
  /run-created/.test(histReasons) && /team-formed/.test(histReasons) && /smoke-test-cancel/.test(histReasons)
    ? ok('state-history includes run-created + team-formed + smoke-test-cancel reasons')
    : bad(`state-history reasons = ${histReasons}`);

  // ---- reconcileOnBoot ----
  console.log('\n[4/4] reconcileOnBoot');
  // Create a second run that pretends to be held by a different (dead) process
  const orphanMeta = await ts.start({
    taskDescription: 'orphan test',
    flow: 'fan-out-collect',
    flowConfig: {},
    members: [{ member_id: 'm1', instance_alias: 'one' }],
  });
  const runId2 = orphanMeta.id;
  await writeJsonFile(join(paths.teamRunsDir, runId2, 'holder.pid'), '999999');
  await ts.transition(runId2, 'pending', 'assembling', 'formed');
  const r = await ts.reconcileOnBoot();
  r.interrupted.includes(runId2) ? ok(`reconcileOnBoot marked ${runId2} as interrupted`) : bad(`expected ${runId2} in ${JSON.stringify(r.interrupted)}`);
  const reloadedOrphan = await ts.readMeta(runId2);
  reloadedOrphan?.state === 'interrupted'
    ? ok('orphan run is now state=interrupted')
    : bad(`orphan run state = ${reloadedOrphan?.state}`);

  console.log('');
  if (fail === 0) {
    console.log(`\u2705 smoke-test passed (${pass} checks)`);
    process.exit(0);
  } else {
    console.error(`\u274c smoke-test failed (${pass} passed, ${fail} failed)`);
    process.exit(1);
  }
} catch (error) {
  console.error(`\u274c smoke-test threw: ${error.message}\n${error.stack}`);
  process.exit(1);
} finally {
  // Best-effort cleanup; ignore failures on Windows where temp dirs may be locked
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
