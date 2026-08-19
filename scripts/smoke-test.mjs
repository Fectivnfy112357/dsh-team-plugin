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
  console.log('[1/8] paths.js');
  const { resolveTeamPaths, runDir } = await importService('services/paths.js');
  const paths = resolveTeamPaths();
  paths.teamRunsDir === join(tmp, '.dsh', 'team-runs')
    ? ok('teamRunsDir = <DSH_PROJECT_DIR>/.dsh/team-runs')
    : bad(`teamRunsDir = ${paths.teamRunsDir}`);
  paths.globalRoot === join(tmp, 'home')
    ? ok('globalRoot = DSH_HOME')
    : bad(`globalRoot = ${paths.globalRoot}`);

  // ---- log-writer.js ----
  console.log('\n[2/8] log-writer.js');
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
  console.log('\n[3/8] team-service.js');
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
  console.log('\n[4/8] reconcileOnBoot');
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

  // ---- 5. DecisionPointService ----
  console.log('\n[5/8] DecisionPointService');
  const dpSvc = await importService('services/decision-point-service.js');
  dpSvc._resetForTests();
  // Create a run + members so the DP has context
  const dpRunMeta = await ts.start({
    taskDescription: 'DP test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 3 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const dpRunId = dpRunMeta.id;
  await ts.markHolder(dpRunId);
  // Open
  const dp1 = await dpSvc.open({ runId: dpRunId, kind: 'convergence', prompt: 'ok?' });
  dp1.status === 'open' ? ok('open() -> status=open') : bad(`dp1.status=${dp1.status}`);
  typeof dp1.id === 'string' && dp1.id.startsWith('dp-')
    ? ok('dp.id has the expected prefix')
    : bad(`dp.id=${dp1.id}`);
  // Idempotency: a second open of the same kind on the same run returns the same DP
  const dp1b = await dpSvc.open({ runId: dpRunId, kind: 'convergence', prompt: 'ok?' });
  dp1b.id === dp1.id ? ok('open() is idempotent per (run, kind)') : bad(`got new id ${dp1b.id}`);
  // waitingDecisions
  const waiting = dpSvc.waitingDecisions(dpRunId);
  waiting.length === 1 ? ok('waitingDecisions() finds the open DP') : bad(`waiting=${waiting.length}`);
  // Respond
  const responded = await dpSvc.respond(dp1.id, { action: 'continue', feedback: 'more detail please' });
  responded.status === 'responded' ? ok('respond() -> status=responded') : bad(`status=${responded.status}`);
  responded.response?.action === 'continue' ? ok('response.action=continue') : bad(`action=${responded.response?.action}`);
  responded.response?.feedback === 'more detail please' ? ok('response.feedback preserved verbatim') : bad('feedback mismatch');
  // user-intervention-log was written
  const uiLines = readFileSync(join(paths.teamRunsDir, dpRunId, 'user-intervention-log.jsonl'), 'utf-8').trim().split('\n');
  uiLines.length === 1 ? ok('user-intervention-log has 1 entry') : bad(`uiLines.length=${uiLines.length}`);
  const uiEntry = JSON.parse(uiLines[0]);
  uiEntry.decision_point_id === dp1.id && uiEntry.action === 'continue' && uiEntry.is_ad_hoc === false
    ? ok('user-intervention-log entry shape correct')
    : bad(`uiEntry=${JSON.stringify(uiEntry)}`);
  // waitingDecisions is now empty
  dpSvc.waitingDecisions(dpRunId).length === 0 ? ok('waitingDecisions() empty after respond') : bad('still has open DP');

  // ---- 6. MessageService ----
  console.log('\n[6/8] MessageService');
  const msgSvc = await importService('services/message-service.js');
  msgSvc._resetForTests();
  const sentMsg = await msgSvc.send({
    runId: dpRunId,
    from: 'brain',
    to: 'brain',
    topic: 'self-check',
    intent: 'note',
    payload: { body: 'remember to consider Y' },
  });
  sentMsg.kind === 'message' && typeof sentMsg.id === 'string' ? ok('send() -> message entry') : bad(`sentMsg=${JSON.stringify(sentMsg)}`);
  // inbox: brain's session-state.json (created by markHolder) should have the msg id
  const brainState = JSON.parse(readFileSync(join(paths.teamRunsDir, dpRunId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  brainState.inbox?.pending?.includes(sentMsg.id)
    ? ok('receiver inbox.pending contains the message id')
    : bad(`brain inbox=${JSON.stringify(brainState.inbox)}`);
  // a2a-message-log has the entry
  const a2aLines = readFileSync(join(paths.teamRunsDir, dpRunId, 'a2a-message-log.jsonl'), 'utf-8').trim().split('\n');
  JSON.parse(a2aLines[a2aLines.length - 1]).id === sentMsg.id
    ? ok('a2a-message-log appended the message')
    : bad('a2a-message-log tail mismatch');
  // wake dedup: 2nd wake within 5s should be suppressed
  msgSvc.shouldWake(dpRunId, 'brain') === false
    ? ok('wake dedup: 2nd wake within 5s is suppressed')
    : bad('wake dedup not working');
  msgSvc.shouldWake(dpRunId, 'other') === true
    ? ok('wake dedup: different target wakes normally')
    : bad('wake dedup blocks unrelated target');

  // ---- 7. RoundTableFlow ----
  console.log('\n[7/8] RoundTableFlow');
  const flowSvc = await importService('services/flow-engine.js');
  const rtRunMeta = await ts.start({
    taskDescription: 'round-table test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 2 },
    members: [
      { member_id: 'brain', instance_alias: 'b' },
      { member_id: 'critic', instance_alias: 'c' },
    ],
  });
  const rtRunId = rtRunMeta.id;
  await ts.markHolder(rtRunId);
  await ts.transition(rtRunId, 'pending', 'assembling', 'team-formed');
  // Simulate a member posting a conclusion message (the real flow reads a2a-message-log)
  await msgSvc.send({
    runId: rtRunId,
    from: 'critic',
    to: 'brain',
    topic: 'conclusion',
    intent: 'conclude',
    payload: { conclusion: 'we agree the answer is X' },
  });
  // Kick off the flow (don't await — it will block on the DP)
  const flowPromise = flowSvc.run(rtRunId, null);
  // Give the flow a moment to reach the convergence DP
  await new Promise((r) => setTimeout(r, 100));
  // Find the convergence DP and respond with 'complete'
  const convDp = dpSvc.waitingDecisions(rtRunId).find((d) => d.kind === 'convergence');
  convDp ? ok('convergence DP opened by flow engine') : bad('no convergence DP');
  if (convDp) {
    await dpSvc.respond(convDp.id, { action: 'complete' });
    // Wait for flow to settle
    const result = await flowPromise;
    result.terminal === 'succeeded' ? ok('flow terminal=succeeded after user complete') : bad(`terminal=${result.terminal}`);
  }
  // meta.json reflects the terminal state
  const finalMeta = await ts.readMeta(rtRunId);
  finalMeta.state === 'succeeded' ? ok('meta.state=succeeded after flow') : bad(`state=${finalMeta.state}`);

  // ---- 8. setDegraded ----
  console.log('\n[8/8] setDegraded');
  const degRunMeta = await ts.start({
    taskDescription: 'degraded test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const degRunId = degRunMeta.id;
  await ts.transition(degRunId, 'pending', 'assembling', 'ready');
  await ts.transition(degRunId, 'assembling', 'running', 'go');
  const deg = await ts.setDegraded(degRunId, 'member-brain-down');
  deg.degraded_flag === true ? ok('setDegraded flips degraded_flag') : bad(`flag=${deg.degraded_flag}`);
  // Idempotency
  const deg2 = await ts.setDegraded(degRunId, 'second-attempt');
  deg2.degraded_flag === true ? ok('setDegraded is idempotent') : bad('flag cleared on second call');
  // state-history has a degraded-flag-set entry
  const shLines = readFileSync(join(paths.teamRunsDir, degRunId, 'state-history.jsonl'), 'utf-8').trim().split('\n');
  /degraded-flag-set:member-brain-down/.test(shLines.join('\n'))
    ? ok('state-history records degraded-flag-set with reason')
    : bad('degraded-flag-set reason not in state-history');

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
