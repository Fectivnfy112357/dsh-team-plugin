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
  console.log('[1/19] paths.js');
  const { resolveTeamPaths, runDir } = await importService('services/paths.js');
  const paths = resolveTeamPaths();
  paths.teamRunsDir === join(tmp, '.dsh', 'team-runs')
    ? ok('teamRunsDir = <DSH_PROJECT_DIR>/.dsh/team-runs')
    : bad(`teamRunsDir = ${paths.teamRunsDir}`);
  paths.globalRoot === join(tmp, 'home')
    ? ok('globalRoot = DSH_HOME')
    : bad(`globalRoot = ${paths.globalRoot}`);

  // ---- log-writer.js ----
  console.log('\n[2/19] log-writer.js');
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
  console.log('\n[3/19] team-service.js');
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
  console.log('\n[4/19] reconcileOnBoot');
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
  // Pre-populate dispatch-log with one issued-but-not-terminal row (simulates
  // a dispatch that was in flight when the DSH process died) and one
  // already-terminal row (must NOT be re-marked).
  const dispatchSvc = await importService('services/dispatch-service.js');
  const inFlight = await dispatchSvc.dispatch({
    run_id: runId2,
    to: 'm1',
    task: 'in-flight at DSH death',
    context_refs: [],
    seq: 1,
  });
  const done = await dispatchSvc.dispatch({
    run_id: runId2,
    to: 'm1',
    task: 'completed before DSH death',
    context_refs: [],
    seq: 2,
  });
  await dispatchSvc.markTerminal(runId2, done.id, 'completed', {
    produced_artifact_ids: ['art-1'],
  });
  const r = await ts.reconcileOnBoot();
  r.interrupted.includes(runId2) ? ok(`reconcileOnBoot marked ${runId2} as interrupted`) : bad(`expected ${runId2} in ${JSON.stringify(r.interrupted)}`);
  const reloadedOrphan = await ts.readMeta(runId2);
  reloadedOrphan?.state === 'interrupted'
    ? ok('orphan run is now state=interrupted')
    : bad(`orphan run state = ${reloadedOrphan?.state}`);
  // Per-dispatch mark: the in-flight dispatch must now have a terminal line
  // with terminal=interrupted + reason=process-killed; the already-terminal
  // dispatch must be left alone (its terminal line is the latest, not ours).
  const dl = readFileSync(join(paths.teamRunsDir, runId2, 'dispatch-log.jsonl'), 'utf-8')
    .trim().split('\n').map((l) => JSON.parse(l));
  // group by id; keep only the last row per id (terminal marker is always
  // appended after the issue row, so the latest line wins)
  /** @type {Record<string, any>} */
  const lastById = {};
  for (const row of dl) lastById[row.id] = row;
  lastById[inFlight.id]?.terminal === 'interrupted'
    ? ok('in-flight dispatch is now terminal=interrupted')
    : bad(`in-flight dispatch latest = ${JSON.stringify(lastById[inFlight.id])}`);
  lastById[inFlight.id]?.reason === 'process-killed'
    ? ok('in-flight dispatch terminal reason=process-killed')
    : bad(`in-flight dispatch reason = ${lastById[inFlight.id]?.reason}`);
  // existing completed dispatch must not have been re-marked
  lastById[done.id]?.terminal === 'completed'
    ? ok('already-completed dispatch is left alone (not re-marked)')
    : bad(`completed dispatch latest = ${JSON.stringify(lastById[done.id])}`);
  // the issue row for the in-flight dispatch must also still be present
  // (we appended a new line, we did not mutate the original)
  const issueRow = dl.find((r) => r.id === inFlight.id && r.task === inFlight.task);
  issueRow && !issueRow.terminal
    ? ok('original issue row preserved (append-only, not mutated)')
    : bad(`issue row missing or already has terminal: ${JSON.stringify(issueRow)}`);

  // ---- 5. DecisionPointService ----
  console.log('\n[5/19] DecisionPointService');
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
  console.log('\n[6/19] MessageService');
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
  console.log('\n[7/19] RoundTableFlow');
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
  console.log('\n[8/19] setDegraded');
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

  // ---- 9. UI components ----
  console.log('\n[9/19] UI components');
  // 9a) Each component module loads and exports a function
  const { TeamMemberChip } = await importService('ui/team-member-chip.js');
  const { TeamDecisionBadge } = await importService('ui/team-decision-badge.js');
  const { TeamHandoffCard } = await importService('ui/team-handoff-card.js');
  const { TeamHandoffRedo } = await importService('ui/team-handoff-redo.js');
  const { TeamPanel } = await importService('ui/team-panel.js');
  typeof TeamMemberChip === 'function' ? ok('TeamMemberChip is a function') : bad('TeamMemberChip export shape');
  typeof TeamDecisionBadge === 'function' ? ok('TeamDecisionBadge is a function') : bad('TeamDecisionBadge export shape');
  typeof TeamHandoffCard === 'function' ? ok('TeamHandoffCard is a function') : bad('TeamHandoffCard export shape');
  typeof TeamHandoffRedo === 'function' ? ok('TeamHandoffRedo is a function') : bad('TeamHandoffRedo export shape');
  typeof TeamPanel === 'function' ? ok('TeamPanel is a function') : bad('TeamPanel export shape');

  // 9b) Each component renders (via the React shim -> sentinel object)
  const chipEl = TeamMemberChip({ memberId: 'brain', displayName: 'Brain', roleId: 'brain', adapter: 'hermes', state: 'working' });
  chipEl && chipEl.__reactEl && chipEl.type === 'div' && chipEl.props['data-member-id'] === 'brain'
    ? ok('TeamMemberChip renders with memberId / state props')
    : bad(`chipEl=${JSON.stringify(chipEl)}`);

  const badgeEmpty = TeamDecisionBadge({ waitingCount: 0 });
  badgeEmpty === null ? ok('TeamDecisionBadge returns null when waitingCount=0') : bad('badge should be null');
  const badgeOpen = TeamDecisionBadge({ waitingCount: 1, kinds: ['convergence'], runId: 'r1' });
  badgeOpen && badgeOpen.props['data-waiting-count'] === 1 && badgeOpen.props['data-kinds'] === 'convergence'
    ? ok('TeamDecisionBadge renders when waitingCount>0')
    : bad(`badgeOpen=${JSON.stringify(badgeOpen)}`);

  const handoffNormal = TeamHandoffCard({ from: 'brain', to: 'critic', task: 'review', state: 'in_flight' });
  handoffNormal && handoffNormal.props['data-variant'] === 'normal'
    ? ok('TeamHandoffCard defaults to variant=normal')
    : bad(`handoffNormal variant=${handoffNormal?.props?.['data-variant']}`);

  const handoffRedo = TeamHandoffRedo({ from: 'critic', to: 'brain', reason: 'lacks detail', state: 'redo' });
  handoffRedo && handoffRedo.type === TeamHandoffCard && handoffRedo.props.variant === 'redo' && handoffRedo.props.state === 'redo'
    ? ok('TeamHandoffRedo delegates to TeamHandoffCard with variant=redo,state=redo')
    : bad(`handoffRedo type=${handoffRedo?.type?.name ?? handoffRedo?.type} variant=${handoffRedo?.props?.variant}`);

  // 9c) TeamPanel composes the subcomponents when given a runMeta
  const panel = TeamPanel({
    runMeta: {
      id: 'run-test', state: 'running', degraded_flag: false, flow: 'handoff-round-table',
      members: [{ member_id: 'brain', instance_alias: 'b' }, { member_id: 'critic', instance_alias: 'c' }],
    },
    waitingCount: 1, waitingKinds: ['convergence'],
    recentHandoffs: [{ id: 'h1', from: 'brain', to: 'critic', state: 'in_flight' }],
  });
  panel && panel.props['data-run-id'] === 'run-test' && panel.props['data-state'] === 'running'
    ? ok('TeamPanel renders with runMeta')
    : bad(`panel=${JSON.stringify(panel)}`);

  // 9d) TeamPanel with no runMeta shows the empty hint
  const empty = TeamPanel({});
  const emptyChildren = Array.isArray(empty?.props?.children)
    ? empty.props.children.join(' ')
    : (empty?.props?.children ?? '');
  empty && empty.type === 'div' && /No active Team Run/.test(emptyChildren)
    ? ok('TeamPanel empty state shows the hint')
    : bad(`emptyChildren=${emptyChildren}`);

  // 9e) TeamPlan: loading / error / content states (P1.5-a)
  const { TeamPlan, loadPlan, subscribeDps } = await importService('ui/team-plan.js')
    .then(async (m) => {
      // team-plan.js exports TeamPlan + loadPlan; subscribeDps lives on team-panel.js
      const panelMod = await importService('ui/team-panel.js');
      return { TeamPlan: m.TeamPlan, loadPlan: m.loadPlan, subscribeDps: panelMod.subscribeDps };
    });
  typeof TeamPlan === 'function' ? ok('TeamPlan is a function') : bad('TeamPlan export shape');
  typeof loadPlan === 'function' ? ok('loadPlan is a function') : bad('loadPlan export shape');
  // loading state: only planId
  const planLoading = TeamPlan({ planId: 'plan-test' });
  planLoading && planLoading.props['data-state'] === 'loading' && /Loading plan/.test(planLoading.props.children)
    ? ok('TeamPlan shows loading state when plan missing')
    : bad(`planLoading=${JSON.stringify(planLoading)}`);
  // error state
  const planErr = TeamPlan({ planId: 'plan-x', error: 'disk full' });
  planErr && planErr.props['data-state'] === 'error' && /disk full/.test(planErr.props.children)
    ? ok('TeamPlan shows error state when error prop set')
    : bad(`planErr=${JSON.stringify(planErr)}`);
  // content state
  const planContent = TeamPlan({
    plan: {
      id: 'plan-test', run_id: 'run-x', produced_by: 'scheduler',
      body: 'plan body content', derived_from: ['user-intervention-log:dp-1'],
      created_at: '2026-01-01T00:00:00.000Z', produced_in_session: null,
      steps: [
        { role: 'writer', intent: 'produce', expected_artifact: { type: 'doc', desc: 'first draft' } },
        { role: 'editor', intent: 'review', expected_artifact: { type: 'doc', desc: 'reviewed draft' } },
      ],
    },
  });
  planContent && planContent.props['data-state'] === 'content' && planContent.props['data-step-count'] === '2'
    ? ok('TeamPlan shows content state with 2 steps')
    : bad(`planContent state=${planContent?.props?.['data-state']} stepCount=${planContent?.props?.['data-step-count']}`);
  const stepList = planContent.props.children.find((c) => c?.props?.['data-step-list']);
  Array.isArray(stepList?.props?.children) && stepList.props.children.length === 2
    ? ok('TeamPlan renders 2 <li> step elements')
    : bad(`stepList children=${JSON.stringify(stepList?.props?.children)}`);
  // intent badge colour
  const step0 = stepList?.props?.children?.[0];
  step0?.props?.['data-intent'] === 'produce' && step0?.props?.children?.[1]?.props?.['data-intent-badge'] === 'produce'
    ? ok('TeamPlan step 0 has data-intent=produce with intent badge')
    : bad(`step0=${JSON.stringify(step0)}`);

  // 9f) subscribeDps (P1.5-b): onChange fires on ctx emit + dispose works
  typeof subscribeDps === 'function' ? ok('subscribeDps is a function') : bad('subscribeDps export shape');
  // Build a minimal mock ctx that records on() + emit()
  const ctxMock = (() => {
    const listeners = new Map();
    return {
      on(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
        return () => listeners.get(name)?.delete(handler);
      },
      emit(name, payload) {
        const set = listeners.get(name);
        if (!set) return;
        for (const fn of set) fn(payload);
      },
      _listeners: listeners,
    };
  })();
  const seen = [];
  const dispose = subscribeDps(ctxMock, (change) => seen.push(change));
  ctxMock.emit('team/decision-point-open', { runId: 'run-1', kind: 'convergence', id: 'dp-1' });
  ctxMock.emit('team/decision-point-respond', { runId: 'run-1', kind: 'convergence', id: 'dp-1' });
  seen.length === 2 && seen[0].action === 'open' && seen[1].action === 'respond' && seen[0].runId === 'run-1'
    ? ok('subscribeDps forwards open + respond to onChange')
    : bad(`seen=${JSON.stringify(seen)}`);
  // Dispose: subsequent emit should not call onChange
  dispose();
  ctxMock.emit('team/decision-point-open', { runId: 'run-1', kind: 'convergence', id: 'dp-2' });
  seen.length === 2
    ? ok('subscribeDps dispose() removes listeners')
    : bad(`seen after dispose=${JSON.stringify(seen)}`);

  // 9g) wireDecisionPointBridge (P1.5-b): real DP open -> ctx emit
  const { wireDecisionPointBridge } = await importService('lib/index.js');
  const ctxMock2 = (() => {
    const listeners = new Map();
    return {
      on(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
        return () => listeners.get(name)?.delete(handler);
      },
      emit(name, payload) {
        const set = listeners.get(name);
        if (!set) return;
        for (const fn of set) fn(payload);
      },
      logger: { info() {}, warn() {} },
    };
  })();
  // Build a fresh run for the bridge test
  const bridgeRunMeta = await ts.start({
    taskDescription: 'bridge test', flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const bridgeRunId = bridgeRunMeta.id;
  await ts.markHolder(bridgeRunId);
  // Capture the next open + respond
  const captured = [];
  ctxMock2.on('team/decision-point-open', (dp) => captured.push({ kind: dp.kind, runId: dp.runId, action: 'open' }));
  ctxMock2.on('team/decision-point-respond', (dp) => captured.push({ kind: dp.kind, runId: dp.runId, action: 'respond' }));
  // Wire the bridge AFTER the capture listeners (bridge is the producer; capture is the consumer)
  const bridgeDispose = await wireDecisionPointBridge(ctxMock2);
  const bridgeDp = await dpSvc.open({ runId: bridgeRunId, kind: 'convergence', prompt: 'ok?' });
  await dpSvc.respond(bridgeDp.id, { action: 'complete' });
  captured.length === 2 && captured[0].action === 'open' && captured[1].action === 'respond' && captured[0].runId === bridgeRunId
    ? ok('wireDecisionPointBridge forwards DP open + respond to ctx')
    : bad(`captured=${JSON.stringify(captured)}`);
  // Dispose: subsequent open should NOT trigger ctx emit
  bridgeDispose();
  const lenAfterDispose = captured.length;
  const bridgeDp2 = await dpSvc.open({ runId: bridgeRunId, kind: 'fallback', prompt: 'again?' });
  captured.length === lenAfterDispose
    ? ok('bridgeDispose() stops forwarding subsequent DP events')
    : bad(`captured grew after dispose: ${JSON.stringify(captured)}`);
  // Sanity: the new DP is real
  bridgeDp2?.id && bridgeDp2.kind === 'fallback'
    ? ok('bridge dispose does not affect DP service itself')
    : bad(`bridgeDp2=${JSON.stringify(bridgeDp2)}`);

  // ---- 9h. MemberService.joinRun + leaveRun (2.0 #1) ----
  console.log('\n[9h] MemberService.joinRun + leaveRun');
  const memberSvc = await importService('services/member-service.js');
  memberSvc._resetForTests();
  // Write a member catalog entry so `get(memberId)` resolves.
  const { getTeamPaths } = await importService('services/paths.js');
  const { ensureDir } = await importService('services/paths.js');
  const membersDir = getTeamPaths().membersDir;
  await ensureDir(membersDir);
  const { writeFile: _writeFile } = await import('node:fs/promises');
  await _writeFile(
    join(membersDir, 'brain.json'),
    JSON.stringify({ id: 'brain', role_id: 'brain', display_name: 'Brain', persona: '', adapter: 'hermes' }),
    'utf-8',
  );
  await _writeFile(
    join(membersDir, 'critic.json'),
    JSON.stringify({ id: 'critic', role_id: 'critic', display_name: 'Critic', persona: '', adapter: 'hermes' }),
    'utf-8',
  );
  // Build a run + skeleton session-state for the test
  const memberRunMeta = await ts.start({
    taskDescription: 'member test', flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const memberRunId = memberRunMeta.id;
  await ts.markHolder(memberRunId);
  // Mock ctx with a recording subagent runtime
  const startCalls = [];
  const interruptCalls = [];
  const ctxMember = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        startCalls.push(spec);
        return { childId: `child-${startCalls.length}`, messageId: `msg-${startCalls.length}` };
      },
      interrupt: async (targetSessionId, authority) => {
        interruptCalls.push({ targetSessionId, authority });
      },
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
  };
  // joinRun (first call: spawns a child)
  const fakeParent = { id: 'agent-user', session: { id: 'sess-user' } };
  const join1 = await memberSvc.joinRun(ctxMember, memberRunId, 'brain', {
    parent: fakeParent,
    signal: new AbortController().signal,
  });
  join1?.childId?.startsWith('child-') && join1.provider === 'acp-hermes' && join1.state === 'running'
    ? ok('joinRun returns childId + provider + state=running')
    : bad(`join1=${JSON.stringify(join1)}`);
  startCalls.length === 1 ? ok('ctx.subagents.startContinuable called exactly once') : bad(`startCalls=${startCalls.length}`);
  const spec = startCalls[0];
  spec?.provider === 'acp-hermes' && spec?.label === `brain-${memberRunId}` && spec?.request?.parent === fakeParent
    ? ok('startContinuable spec carries provider + label + parent')
    : bad(`spec=${JSON.stringify({ provider: spec?.provider, label: spec?.label, parent: spec?.request?.parent })}`);
  Array.isArray(spec?.request?.prompt) && spec.request.prompt.length > 0
    ? ok('startContinuable spec carries a non-empty prompt')
    : bad(`prompt=${JSON.stringify(spec?.request?.prompt)}`);
  // session-state.json now reflects the running child
  const sessPath = join(paths.teamRunsDir, memberRunId, 'sessions', 'brain', 'session-state.json');
  const sess = JSON.parse(readFileSync(sessPath, 'utf-8'));
  sess.state === 'running' && sess.child_id === join1.childId && sess.provider === 'acp-hermes'
    ? ok('session-state.json updated: state=running, child_id + provider set')
    : bad(`sess=${JSON.stringify({ state: sess.state, child_id: sess.child_id, provider: sess.provider })}`);
  Array.isArray(sess.session_chain) && sess.session_chain.includes(join1.childId)
    ? ok('session-state.json session_chain contains the new childId')
    : bad(`chain=${JSON.stringify(sess.session_chain)}`);
  // dispatch-log has a member-join row
  const dlAfterJoin = readFileSync(join(paths.teamRunsDir, memberRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const joinRow = dlAfterJoin.find((r) => r.kind === 'member-join' && r.to === 'brain');
  joinRow && joinRow.child_id === join1.childId && joinRow.provider === 'acp-hermes'
    ? ok('dispatch-log has member-join row pointing at the new child')
    : bad(`joinRow=${JSON.stringify(joinRow)}`);
  // Idempotency: a second joinRun does NOT call startContinuable again
  const join2 = await memberSvc.joinRun(ctxMember, memberRunId, 'brain', { parent: fakeParent });
  join2.childId === join1.childId && startCalls.length === 1
    ? ok('joinRun is idempotent: second call returns the existing record')
    : bad(`join2=${JSON.stringify(join2)} startCalls=${startCalls.length}`);
  // leaveRun (with authority -> triggers interrupt)
  const leave1 = await memberSvc.leaveRun(ctxMember, memberRunId, 'brain', {
    reason: 'flow terminal',
    authority: { kind: 'user', parentSessionId: 'sess-user' },
  });
  leave1.state === 'terminated' && leave1.interrupted === true
    ? ok('leaveRun marks state=terminated and calls interrupt when authority given')
    : bad(`leave1=${JSON.stringify(leave1)}`);
  interruptCalls.length === 1 && interruptCalls[0].targetSessionId === join1.childId
    ? ok('interrupt called with the live child session id')
    : bad(`interruptCalls=${JSON.stringify(interruptCalls)}`);
  const sessAfterLeave = JSON.parse(readFileSync(sessPath, 'utf-8'));
  sessAfterLeave.state === 'terminated' && sessAfterLeave.leave_reason === 'flow terminal'
    ? ok('session-state.json: state=terminated + leave_reason recorded')
    : bad(`sessAfterLeave=${JSON.stringify({ state: sessAfterLeave.state, leave_reason: sessAfterLeave.leave_reason })}`);
  const dlAfterLeave = readFileSync(join(paths.teamRunsDir, memberRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const leaveRow = dlAfterLeave.find((r) => r.kind === 'member-leave' && r.to === 'brain');
  leaveRow && leaveRow.interrupted === true
    ? ok('dispatch-log has member-leave row with interrupted=true')
    : bad(`leaveRow=${JSON.stringify(leaveRow)}`);
  // Re-leave is a no-op (idempotent)
  const leave2 = await memberSvc.leaveRun(ctxMember, memberRunId, 'brain', { reason: 'again' });
  leave2.state === 'terminated' && interruptCalls.length === 1
    ? ok('leaveRun is idempotent: re-leave does not re-interrupt')
    : bad(`leave2=${JSON.stringify(leave2)} interruptCalls=${interruptCalls.length}`);

  // ---- 9j. MemberService.sendMessage / dispatch / wake / triggerSelfHandoff (2.0 #1 留口 #2) ----
  console.log('\n[9j] MemberService.sendMessage / dispatch / wake / triggerSelfHandoff');
  memberSvc._resetForTests();
  // Set up a fresh run with 2 members joined: 'brain' (sender) and 'critic' (recipient).
  // The mock ctx records followup / startContinuable / interrupt calls.
  const followupCalls = [];
  const startCalls2 = [];
  const interruptCalls2 = [];
  const ctxMs2 = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        startCalls2.push(spec);
        return { childId: `child-${startCalls2.length}-${Date.now().toString(36)}`, messageId: `msg-${startCalls2.length}-${Date.now().toString(36)}` };
      },
      followup: async (parent, childId, content, options) => {
        followupCalls.push({ parent, childId, content, options });
        return `fup-${followupCalls.length}-${Date.now().toString(36)}`;
      },
      interrupt: async (targetSessionId, authority) => {
        interruptCalls2.push({ targetSessionId, authority });
      },
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
  };
  // New run with both members
  const ms2Meta = await ts.start({
    taskDescription: 'ms2 test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [
      { member_id: 'brain', instance_alias: 'b' },
      { member_id: 'critic', instance_alias: 'c' },
    ],
  });
  const ms2RunId = ms2Meta.id;
  await ts.markHolder(ms2RunId);
  // Pre-join both members so the recipient is 'running' for the followup
  // tests below. joinRun inside this test doesn't pollute the prior ctx
  // because we use a separate ctxMs2 (mock counts are separate).
  const brainJoin = await memberSvc.joinRun(ctxMs2, ms2RunId, 'brain', { signal: new AbortController().signal });
  const criticJoin = await memberSvc.joinRun(ctxMs2, ms2RunId, 'critic', { signal: new AbortController().signal });
  brainJoin.state === 'running' && criticJoin.state === 'running'
    ? ok('pre-join: both members in state=running')
    : bad(`brainJoin=${JSON.stringify(brainJoin)} criticJoin=${JSON.stringify(criticJoin)}`);

  // ---- sendMessage: brain -> critic ----
  const sendBefore = followupCalls.length;
  const smResult = await memberSvc.sendMessage(ctxMs2, ms2RunId, 'brain', {
    to: 'critic',
    topic: 'clarify',
    intent: 'request-info',
    payload: { q: 'what about X?' },
  }, { parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } } });
  smResult.entry?.id && smResult.entry.kind === 'message' && smResult.entry.from === 'brain' && smResult.entry.to === 'critic'
    ? ok('sendMessage returns a2a entry with from=brain to=critic kind=message')
    : bad(`smResult.entry=${JSON.stringify(smResult.entry)}`);
  // a2a-message-log has 1 row
  const a2aMs2Lines = readFileSync(join(paths.teamRunsDir, ms2RunId, 'a2a-message-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  a2aMs2Lines.length === 1 && a2aMs2Lines[0].id === smResult.entry.id
    ? ok('a2a-message-log has 1 row matching the entry id')
    : bad(`a2aMs2Lines=${JSON.stringify(a2aMs2Lines)}`);
  // critic inbox has the message pending
  const criticInbox = JSON.parse(readFileSync(join(paths.teamRunsDir, ms2RunId, 'sessions', 'critic', 'session-state.json'), 'utf-8'));
  criticInbox.inbox?.pending?.includes(smResult.entry.id)
    ? ok("critic's session-state.json inbox.pending contains the message id")
    : bad(`criticInbox.inbox=${JSON.stringify(criticInbox.inbox)}`);
  // followup was called on critic's child
  followupCalls.length === sendBefore + 1 && followupCalls[followupCalls.length - 1].childId === criticJoin.childId
    ? ok('sendMessage fired ctx.subagents.followup against critic.child_id')
    : bad(`followupCalls tail=${JSON.stringify(followupCalls.at(-1))}`);
  // brain inbox should NOT have the message (sender doesn't get their own)
  const brainInbox = JSON.parse(readFileSync(join(paths.teamRunsDir, ms2RunId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  !brainInbox.inbox?.pending?.includes(smResult.entry.id)
    ? ok("brain's inbox does NOT contain the message it sent")
    : bad(`brain inbox unexpectedly contains ${smResult.entry.id}`);

  // ---- sendMessage: broadcast does NOT call followup ----
  const followupBeforeBroadcast = followupCalls.length;
  await memberSvc.sendMessage(ctxMs2, ms2RunId, 'brain', {
    to: 'broadcast',
    topic: 'announce',
    intent: 'notify',
    payload: { text: 'hi all' },
  });
  followupCalls.length === followupBeforeBroadcast
    ? ok('sendMessage to broadcast does NOT call followup (each member reads its own inbox)')
    : bad(`followup calls after broadcast = ${followupCalls.length - followupBeforeBroadcast}`);

  // ---- dispatch: auto-joins if not running, follows up with task ----
  memberSvc._resetForTests();
  // Use a brand-new run with a fresh member to test the auto-join branch
  const dispatchMeta = await ts.start({
    taskDescription: 'dispatch test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const dispatchRunId = dispatchMeta.id;
  await ts.markHolder(dispatchRunId);
  const startBeforeDispatch = startCalls2.length;
  const followupBeforeDispatch = followupCalls.length;
  const dispatchResult = await memberSvc.dispatch(ctxMs2, dispatchRunId, 'brain', {
    task: 'first dispatch task',
    contextRefs: ['art-1', 'art-2'],
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
  });
  dispatchResult.joinedNow === true && startCalls2.length === startBeforeDispatch + 1
    ? ok('dispatch auto-joins an unjoined member (joinedNow=true, startContinuable called)')
    : bad(`dispatchResult.joinedNow=${dispatchResult.joinedNow} startCalls added=${startCalls2.length - startBeforeDispatch}`);
  followupCalls.length === followupBeforeDispatch + 1
    ? ok('dispatch calls followup after (auto-)join')
    : bad(`followupCalls added=${followupCalls.length - followupBeforeDispatch}`);
  // dispatch-log has a row with from=scheduler to=brain
  const dispatchLog = readFileSync(join(paths.teamRunsDir, dispatchRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const dRow = dispatchLog.find((r) => r.from === 'scheduler' && r.to === 'brain' && r.task === 'first dispatch task');
  dRow && Array.isArray(dRow.context_refs) && dRow.context_refs.length === 2
    ? ok('dispatch-log has scheduler->brain row with 2 context_refs')
    : bad(`dRow=${JSON.stringify(dRow)}`);

  // ---- dispatch: idempotent (already joined -> no second startContinuable) ----
  const startBeforeDispatch2 = startCalls2.length;
  const dispatchResult2 = await memberSvc.dispatch(ctxMs2, dispatchRunId, 'brain', {
    task: 'second dispatch',
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
  });
  dispatchResult2.joinedNow === false && startCalls2.length === startBeforeDispatch2
    ? ok('dispatch is idempotent: already-joined member gets followup only (no second startContinuable)')
    : bad(`dispatchResult2.joinedNow=${dispatchResult2.joinedNow} startCalls added=${startCalls2.length - startBeforeDispatch2}`);

  // ---- wake: force-wake, no dedup, calls followup ----
  memberSvc._resetForTests();
  const wakeBefore = followupCalls.length;
  const wakeResult = await memberSvc.wake(ctxMs2, ms2RunId, 'critic', {
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
    reason: 'kick-test',
  });
  wakeResult.dispatched === true && followupCalls.length === wakeBefore + 1
    ? ok('wake fires followup on the live child (no dedup)')
    : bad(`wakeResult=${JSON.stringify(wakeResult)} followup added=${followupCalls.length - wakeBefore}`);
  // Two wakes in quick succession should both dispatch (no dedup)
  const wakeBefore2 = followupCalls.length;
  await memberSvc.wake(ctxMs2, ms2RunId, 'critic', {
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
    reason: 'kick-test-2',
  });
  followupCalls.length === wakeBefore2 + 1
    ? ok('wake does NOT dedup: two rapid wakes both fire followup')
    : bad(`second wake followup added=${followupCalls.length - wakeBefore2}`);
  // wake with no parent or no live child returns dispatched=false
  const wakeDead = await memberSvc.wake(ctxMs2, ms2RunId, 'nonexistent-member', {
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
  });
  wakeDead.dispatched === false
    ? ok('wake to non-joined member returns dispatched=false (no followup)')
    : bad(`wakeDead=${JSON.stringify(wakeDead)}`);

  // ---- triggerSelfHandoff: interrupts old child, starts new, chain-append ----
  memberSvc._resetForTests();
  const handoffBefore = {
    start: startCalls2.length,
    interrupt: interruptCalls2.length,
  };
  // ms2 still has 'brain' running from earlier. Trigger its self-handoff.
  const brainSessionBefore = JSON.parse(readFileSync(join(paths.teamRunsDir, ms2RunId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  const oldChildId = brainSessionBefore.current_session_id;
  const oldChainLen = (brainSessionBefore.session_chain ?? []).length;
  const oldCount = brainSessionBefore.self_handoff_count ?? 0;
  const handoffResult = await memberSvc.triggerSelfHandoff(ctxMs2, ms2RunId, 'brain', {
    reason: 'context-overflow',
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
    handoffFile: 'handoff-1.md',
    promptOverride: [
      { type: 'text', text: '[persona]\n[handoff-1.md content]\n[task: continue with X]' },
    ],
  });
  interruptCalls2.length === handoffBefore.interrupt + 1 && interruptCalls2.at(-1).targetSessionId === oldChildId
    ? ok('triggerSelfHandoff interrupts the old child')
    : bad(`interrupt added=${interruptCalls2.length - handoffBefore.interrupt} target=${interruptCalls2.at(-1)?.targetSessionId}`);
  startCalls2.length === handoffBefore.start + 1
    ? ok('triggerSelfHandoff calls startContinuable for the new child')
    : bad(`start added=${startCalls2.length - handoffBefore.start}`);
  handoffResult.handoffCount === oldCount + 1
    ? ok('handoffCount is incremented')
    : bad(`handoffCount=${handoffResult.handoffCount} oldCount=${oldCount}`);
  // session-state.json: new current_session_id, session_chain append, handoff_files append, self_handoff_count bumped
  const brainSessionAfter = JSON.parse(readFileSync(join(paths.teamRunsDir, ms2RunId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  brainSessionAfter.current_session_id === handoffResult.newChildId && brainSessionAfter.current_session_id !== oldChildId
    ? ok('session-state.json current_session_id replaced with new child')
    : bad(`current_session_id=${brainSessionAfter.current_session_id} newChildId=${handoffResult.newChildId} oldChildId=${oldChildId}`);
  brainSessionAfter.session_chain.length === oldChainLen + 1 && brainSessionAfter.session_chain.includes(handoffResult.newChildId)
    ? ok('session-state.json session_chain has +1 entry including newChildId')
    : bad(`chain len=${brainSessionAfter.session_chain.length} oldLen=${oldChainLen}`);
  brainSessionAfter.handoff_files?.includes('handoff-1.md')
    ? ok('session-state.json handoff_files includes handoff-1.md')
    : bad(`handoff_files=${JSON.stringify(brainSessionAfter.handoff_files)}`);
  brainSessionAfter.state === 'running'
    ? ok('state stays running across the self-handoff (member is the same entity)')
    : bad(`state=${brainSessionAfter.state}`);
  // dispatch-log has a member-self-handoff row
  const ms2Dl = readFileSync(join(paths.teamRunsDir, ms2RunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const handoffRow = ms2Dl.find((r) => r.kind === 'member-self-handoff' && r.to === 'brain');
  handoffRow && handoffRow.child_id_old === oldChildId && handoffRow.child_id === handoffResult.newChildId && handoffRow.handoff_file === 'handoff-1.md'
    ? ok('dispatch-log has member-self-handoff row with child_id_old/new + handoff_file')
    : bad(`handoffRow=${JSON.stringify(handoffRow)}`);

  // ---- 9i. Cross-plugin service bundle (2.0 #3) ----
  console.log('\n[9i] Cross-plugin service bundle (2.0 #3)');
  const { createTeamServiceBundle, registerTeamServices } = await importService('lib/index.js');
  // createTeamServiceBundle: shape + freezing
  const bundle = await createTeamServiceBundle();
  bundle && typeof bundle === 'object'
    ? ok('createTeamServiceBundle() returns an object')
    : bad(`bundle=${typeof bundle}`);
  Object.isFrozen(bundle)
    ? ok('bundle is frozen (cross-plugin contract)')
    : bad('bundle is mutable');
  const expectedKeys = ['team', 'members', 'decisions', 'messages', 'plans', 'artifacts'];
  const actualKeys = Object.keys(bundle).sort();
  JSON.stringify(actualKeys) === JSON.stringify([...expectedKeys].sort())
    ? ok('bundle exposes the 6 expected service keys')
    : bad(`keys=${JSON.stringify(actualKeys)}`);
  // Each key resolves to a real ES module namespace (has at least one function)
  const keyToExpected = {
    team: ['start', 'list', 'abort'],
    members: ['list', 'get', 'joinRun', 'leaveRun'],
    decisions: ['open', 'respond', 'get', 'waitingDecisions'],
    messages: ['send', 'shouldWake'],
    plans: ['generate', 'get', 'list'],
    artifacts: ['register', 'get', 'list', 'refCount', 'canDelete'],
  };
  let allKeysResolve = true;
  for (const [k, fns] of Object.entries(keyToExpected)) {
    const mod = bundle[k];
    for (const fn of fns) {
      if (typeof mod?.[fn] !== 'function') { allKeysResolve = false; break; }
    }
    if (!allKeysResolve) break;
  }
  allKeysResolve
    ? ok('each bundle key has all the expected exported functions')
    : bad('one or more bundle keys missing functions');
  // registerTeamServices: no-op on a context lacking provide/effect
  let noopOk = true;
  const noopDisposer = await registerTeamServices(null);
  if (typeof noopDisposer !== 'function') noopOk = false;
  await noopDisposer();
  const noopDisposerPartial = await registerTeamServices({ logger: { info() {} } });
  if (typeof noopDisposerPartial !== 'function') noopOk = false;
  await noopDisposerPartial();
  noopOk ? ok('registerTeamServices() no-op when ctx lacks provide/effect') : bad('no-op path threw');
  // registerTeamServices: calls ctx.provide('team', bundle) under ctx.effect
  const provideCalls = [];
  const effectCalls = [];
  const effectDisposers = [];
  const fakeCtx = {
    provide(name, value) {
      provideCalls.push({ name, value });
      return () => { provideCalls.push({ name, disposed: true }); };
    },
    effect(callback, label) {
      effectCalls.push(label);
      const disposer = callback();
      effectDisposers.push(disposer);
      return () => { effectDisposers.push({ disposed: true }); };
    },
    logger: { info() {}, warn() {} },
  };
  const realDisposer = await registerTeamServices(fakeCtx);
  effectCalls.length === 1
    ? ok('registerTeamServices() wraps registration in ctx.effect')
    : bad(`effectCalls=${JSON.stringify(effectCalls)}`);
  // Note: `bundle` (test) and the value passed to ctx.provide (inside the helper)
  // are two distinct frozen objects because createTeamServiceBundle is called
  // twice. The contract is shape, not identity — assert by structure.
  const passedValue = provideCalls[0]?.value;
  const passedIsObject = passedValue && typeof passedValue === 'object';
  const passedIsFrozen = passedIsObject && Object.isFrozen(passedValue);
  const passedKeys = passedIsObject ? Object.keys(passedValue).sort() : [];
  const passedHasTeamStart = passedIsObject && typeof passedValue.team?.start === 'function';
  const shapeOk = passedIsObject && passedIsFrozen
    && JSON.stringify(passedKeys) === JSON.stringify(actualKeys)
    && passedHasTeamStart;
  shapeOk
    ? ok('ctx.provide(\'team\', frozen bundle with 6 keys + team.start) called once')
    : bad(`shape: object=${passedIsObject} frozen=${passedIsFrozen} keys=${JSON.stringify(passedKeys)} teamHasStart=${passedHasTeamStart}`);
  typeof realDisposer === 'function'
    ? ok('registerTeamServices() returns a disposer (no-op; effect owns cleanup)')
    : bad('registerTeamServices() did not return a function');
  // registerTeamServices: the in-effect disposer from ctx.provide is captured,
  // and the outer effect's disposer chain would call it on plugin unload.
  effectDisposers.length >= 1 && typeof effectDisposers[0] === 'function'
    ? ok('ctx.effect captured the ctx.provide disposer for unload')
    : bad(`effectDisposers=${JSON.stringify(effectDisposers.map((d) => typeof d))}`);
  // Calling the captured disposer removes the registration (simulated)
  effectDisposers[0]();
  provideCalls.length === 2 && provideCalls[1].disposed === true
    ? ok('captured disposer triggers the underlying ctx.provide disposer')
    : bad(`provideCalls after dispose=${JSON.stringify(provideCalls)}`);

  // ---- 10. PipelineFlow: 2-step pipeline, both complete -> succeeded ----
  console.log('\n[10/19] PipelineFlow (happy path)');
  const pipeSvc = await importService('services/pipeline-flow.js');
  pipeSvc._resetForTests();
  const pipeMeta = await ts.start({
    taskDescription: 'pipeline test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write the doc', max_retries: 1, intent: 'produce' },
        { member_id: 'editor', task: 'edit the doc', max_retries: 0, intent: 'review' },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const pipeRunId = pipeMeta.id;
  await ts.markHolder(pipeRunId);
  await ts.transition(pipeRunId, 'pending', 'assembling', 'team-formed');
  // Kick off the flow; the in-memory step waiter blocks until signal.
  const pipePromise = flowSvc.run(pipeRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  // Step 0 -> complete with an artifact
  pipeSvc.signalStepTerminal(pipeRunId, 0, 'complete', { produced_artifact_ids: ['doc-v1'] });
  await new Promise((r) => setTimeout(r, 50));
  // Step 1 -> complete
  pipeSvc.signalStepTerminal(pipeRunId, 1, 'complete', { produced_artifact_ids: ['doc-v2'] });
  const pipeResult = await pipePromise;
  pipeResult.terminal === 'succeeded'
    ? ok('happy path: 2-step pipeline -> succeeded')
    : bad(`terminal=${pipeResult.terminal}`);
  const pipeFinalMeta = await ts.readMeta(pipeRunId);
  pipeFinalMeta.state === 'succeeded' ? ok('pipeline meta.state=succeeded') : bad(`state=${pipeFinalMeta.state}`);
  // handoff-log has 4 entries: start0, complete0, start1, complete1
  const hlLines = readFileSync(join(paths.teamRunsDir, pipeRunId, 'handoff-log.jsonl'), 'utf-8').trim().split('\n');
  hlLines.length === 4 ? ok('handoff-log has 4 entries (start+complete per step)') : bad(`handoff-log len=${hlLines.length}`);
  // dispatch-log has 2 entries (DSH -> writer, DSH -> editor)
  const dlLines = readFileSync(join(paths.teamRunsDir, pipeRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n');
  // 2 dispatches + 2 markTerminal appends = 4 lines
  dlLines.length === 4 ? ok('dispatch-log has 4 entries (2 dispatches + 2 markTerminal)') : bad(`dispatch-log len=${dlLines.length}`);

  // ---- 11. PipelineFlow: step 0 fails, retry with feedback, then succeeds ----
  console.log('\n[11/19] PipelineFlow (feedback loop)');
  pipeSvc._resetForTests();
  const fbMeta = await ts.start({
    taskDescription: 'pipeline feedback test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write the doc', max_retries: 1, intent: 'produce' },
      ],
    },
    members: [{ member_id: 'writer', instance_alias: 'w' }],
  });
  const fbRunId = fbMeta.id;
  await ts.markHolder(fbRunId);
  await ts.transition(fbRunId, 'pending', 'assembling', 'team-formed');
  const fbPromise = flowSvc.run(fbRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  // First attempt: fail with feedback
  pipeSvc.signalStepTerminal(fbRunId, 0, 'fail', { feedback: 'add more detail on section 2' });
  await new Promise((r) => setTimeout(r, 50));
  // Second attempt: complete
  pipeSvc.signalStepTerminal(fbRunId, 0, 'complete', { produced_artifact_ids: ['doc-v2'] });
  const fbResult = await fbPromise;
  fbResult.terminal === 'succeeded'
    ? ok('feedback loop: fail then retry -> succeeded')
    : bad(`terminal=${fbResult.terminal}`);
  // handoff-log: 1 start + 1 fail-handoff + 1 second start + 1 complete-handoff = 4 entries
  const fbHlLines = readFileSync(join(paths.teamRunsDir, fbRunId, 'handoff-log.jsonl'), 'utf-8').trim().split('\n');
  fbHlLines.length === 4 ? ok('feedback loop handoff-log has 4 entries') : bad(`fb handoff-log len=${fbHlLines.length}`);

  // ---- 12. PipelineFlow: max_retries=0, fail -> failed terminal ----
  console.log('\n[12/19] PipelineFlow (no retries)');
  pipeSvc._resetForTests();
  const noMeta = await ts.start({
    taskDescription: 'pipeline no-retry test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write the doc', max_retries: 0, intent: 'produce' },
      ],
    },
    members: [{ member_id: 'writer', instance_alias: 'w' }],
  });
  const noRunId = noMeta.id;
  await ts.markHolder(noRunId);
  await ts.transition(noRunId, 'pending', 'assembling', 'team-formed');
  const noPromise = flowSvc.run(noRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  pipeSvc.signalStepTerminal(noRunId, 0, 'fail', { feedback: 'unsalvageable' });
  const noResult = await noPromise;
  noResult.terminal === 'failed' ? ok('max_retries=0 + fail -> failed') : bad(`terminal=${noResult.terminal}`);
  const noFinalMeta = await ts.readMeta(noRunId);
  noFinalMeta.state === 'failed' ? ok('no-retry meta.state=failed') : bad(`state=${noFinalMeta.state}`);

  // ---- 12b. PipelineFlow: 2.0 #4 context_refs propagation ----
  console.log('\n[12b/19] PipelineFlow (2.0 #4 context_refs propagation)');
  pipeSvc._resetForTests();
  // 3-step pipeline: step 0 produces [a-1], step 1's dispatch should auto-include [a-1];
  // step 1 produces [a-2,a-3], step 2's dispatch should auto-include [a-2,a-3].
  const crMeta = await ts.start({
    taskDescription: 'pipeline context_refs test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write v1', intent: 'produce' },
        { member_id: 'editor', task: 'edit v1', intent: 'review' },
        { member_id: 'publisher', task: 'publish final', intent: 'produce' },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
      { member_id: 'publisher', instance_alias: 'p' },
    ],
  });
  const crRunId = crMeta.id;
  await ts.markHolder(crRunId);
  await ts.transition(crRunId, 'pending', 'assembling', 'team-formed');
  const crPromise = flowSvc.run(crRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  // step 0 complete with [a-1]
  pipeSvc.signalStepTerminal(crRunId, 0, 'complete', { produced_artifact_ids: ['a-1'] });
  await new Promise((r) => setTimeout(r, 50));
  // step 1: read dispatch-log to verify context_refs auto-derived
  const crDl = readFileSync(join(paths.teamRunsDir, crRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const editorDispatch = crDl.find((r) => r.to === 'editor' && r.task === 'edit v1');
  editorDispatch && JSON.stringify(editorDispatch.context_refs) === JSON.stringify(['a-1'])
    ? ok('step 1 dispatch.context_refs auto-derives from step 0 produced_artifact_ids')
    : bad(`editorDispatch=${JSON.stringify(editorDispatch)}`);
  // step 1 complete with [a-2, a-3]
  pipeSvc.signalStepTerminal(crRunId, 1, 'complete', { produced_artifact_ids: ['a-2', 'a-3'] });
  await new Promise((r) => setTimeout(r, 50));
  // step 2: read dispatch-log to verify [a-2, a-3]
  const crDl2 = readFileSync(join(paths.teamRunsDir, crRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const publisherDispatch = crDl2.find((r) => r.to === 'publisher' && r.task === 'publish final');
  publisherDispatch && JSON.stringify(publisherDispatch.context_refs) === JSON.stringify(['a-2', 'a-3'])
    ? ok('step 2 dispatch.context_refs auto-derives from step 1 produced_artifact_ids (multi-artifact)')
    : bad(`publisherDispatch=${JSON.stringify(publisherDispatch)}`);
  // step 2 complete -> succeeded
  pipeSvc.signalStepTerminal(crRunId, 2, 'complete', { produced_artifact_ids: ['final'] });
  const crResult = await crPromise;
  crResult.terminal === 'succeeded' ? ok('3-step auto-propagation pipeline -> succeeded') : bad(`terminal=${crResult.terminal}`);

  // Override: step.context_refs takes precedence over derived
  pipeSvc._resetForTests();
  const ovMeta = await ts.start({
    taskDescription: 'context_refs override test (step-level)',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write v1', intent: 'produce' },
        { member_id: 'editor', task: 'edit v1', intent: 'review', context_refs: ['manual-1', 'manual-2'] },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const ovRunId = ovMeta.id;
  await ts.markHolder(ovRunId);
  await ts.transition(ovRunId, 'pending', 'assembling', 'team-formed');
  const ovPromise = flowSvc.run(ovRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  pipeSvc.signalStepTerminal(ovRunId, 0, 'complete', { produced_artifact_ids: ['derived-art'] });
  await new Promise((r) => setTimeout(r, 50));
  const ovDl = readFileSync(join(paths.teamRunsDir, ovRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const ovEditor = ovDl.find((r) => r.to === 'editor' && r.task === 'edit v1');
  ovEditor && JSON.stringify(ovEditor.context_refs) === JSON.stringify(['manual-1', 'manual-2'])
    ? ok('step.context_refs overrides the auto-derived context_refs')
    : bad(`ovEditor=${JSON.stringify(ovEditor)}`);
  pipeSvc.signalStepTerminal(ovRunId, 1, 'complete', { produced_artifact_ids: ['edited'] });
  await ovPromise;

  // Override: flow_config.context_refs_override[stepIndex]
  pipeSvc._resetForTests();
  const fovMeta = await ts.start({
    taskDescription: 'context_refs override test (flow-level)',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write v1', intent: 'produce' },
        { member_id: 'editor', task: 'edit v1', intent: 'review' },
      ],
      context_refs_override: {
        1: ['flow-override-1'],
      },
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const fovRunId = fovMeta.id;
  await ts.markHolder(fovRunId);
  await ts.transition(fovRunId, 'pending', 'assembling', 'team-formed');
  const fovPromise = flowSvc.run(fovRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  pipeSvc.signalStepTerminal(fovRunId, 0, 'complete', { produced_artifact_ids: ['derived-art'] });
  await new Promise((r) => setTimeout(r, 50));
  const fovDl = readFileSync(join(paths.teamRunsDir, fovRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const fovEditor = fovDl.find((r) => r.to === 'editor' && r.task === 'edit v1');
  fovEditor && JSON.stringify(fovEditor.context_refs) === JSON.stringify(['flow-override-1'])
    ? ok('flow_config.context_refs_override[1] overrides auto-derived context_refs')
    : bad(`fovEditor=${JSON.stringify(fovEditor)}`);
  pipeSvc.signalStepTerminal(fovRunId, 1, 'complete', { produced_artifact_ids: ['edited'] });
  await fovPromise;

  // Feedback retry: step 0 fails then succeeds with different artifacts; step 1
  // should derive from the FINAL attempt's produced_artifact_ids (not the
  // would-have-been empty list from a hypothetical first-attempt record).
  pipeSvc._resetForTests();
  const frMeta = await ts.start({
    taskDescription: 'context_refs feedback-retry test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write', intent: 'produce', max_retries: 1 },
        { member_id: 'editor', task: 'edit', intent: 'review' },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const frRunId = frMeta.id;
  await ts.markHolder(frRunId);
  await ts.transition(frRunId, 'pending', 'assembling', 'team-formed');
  const frPromise = flowSvc.run(frRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  pipeSvc.signalStepTerminal(frRunId, 0, 'fail', { feedback: 'add more detail' });
  await new Promise((r) => setTimeout(r, 50));
  pipeSvc.signalStepTerminal(frRunId, 0, 'complete', { produced_artifact_ids: ['retry-art'] });
  await new Promise((r) => setTimeout(r, 50));
  const frDl = readFileSync(join(paths.teamRunsDir, frRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const frEditor = frDl.find((r) => r.to === 'editor' && r.task === 'edit');
  frEditor && JSON.stringify(frEditor.context_refs) === JSON.stringify(['retry-art'])
    ? ok('context_refs derives from the FINAL successful attempt (after feedback retry)')
    : bad(`frEditor=${JSON.stringify(frEditor)}`);
  pipeSvc.signalStepTerminal(frRunId, 1, 'complete', { produced_artifact_ids: ['edited-retry'] });
  await frPromise;

  // Per-run isolation: _stepOutputs cleared by _resetForTests, and a fresh
  // run starts with no prior step outputs
  pipeSvc._resetForTests();
  const isoMeta = await ts.start({
    taskDescription: 'context_refs isolation test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write fresh', intent: 'produce' },
        { member_id: 'editor', task: 'edit fresh', intent: 'review' },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const isoRunId = isoMeta.id;
  await ts.markHolder(isoRunId);
  await ts.transition(isoRunId, 'pending', 'assembling', 'team-formed');
  // step 0 produces no artifacts (undefined -> empty array)
  const isoPromise = flowSvc.run(isoRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  pipeSvc.signalStepTerminal(isoRunId, 0, 'complete', { produced_artifact_ids: [] });
  await new Promise((r) => setTimeout(r, 50));
  const isoDl = readFileSync(join(paths.teamRunsDir, isoRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const isoEditor = isoDl.find((r) => r.to === 'editor' && r.task === 'edit fresh');
  Array.isArray(isoEditor?.context_refs) && isoEditor.context_refs.length === 0
    ? ok('step 1 context_refs is empty when step 0 produced no artifacts (clean per-run state)')
    : bad(`isoEditor=${JSON.stringify(isoEditor)}`);
  pipeSvc.signalStepTerminal(isoRunId, 1, 'complete', { produced_artifact_ids: ['done'] });
  await isoPromise;

  // _resetForTests clears stepOutputs
  pipeSvc._resetForTests();
  // After reset, a fresh run's step 1 should NOT see a previous run's outputs
  const cleanMeta = await ts.start({
    taskDescription: 'context_refs post-reset test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'writer', task: 'write', intent: 'produce' },
        { member_id: 'editor', task: 'edit', intent: 'review' },
      ],
    },
    members: [
      { member_id: 'writer', instance_alias: 'w' },
      { member_id: 'editor', instance_alias: 'e' },
    ],
  });
  const cleanRunId = cleanMeta.id;
  await ts.markHolder(cleanRunId);
  await ts.transition(cleanRunId, 'pending', 'assembling', 'team-formed');
  const cleanPromise = flowSvc.run(cleanRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  // Skip step 0's complete, manually complete step 0 with a known artifact
  pipeSvc.signalStepTerminal(cleanRunId, 0, 'complete', { produced_artifact_ids: ['fresh-art'] });
  await new Promise((r) => setTimeout(r, 50));
  const cleanDl = readFileSync(join(paths.teamRunsDir, cleanRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const cleanEditor = cleanDl.find((r) => r.to === 'editor' && r.task === 'edit');
  cleanEditor && JSON.stringify(cleanEditor.context_refs) === JSON.stringify(['fresh-art'])
    ? ok('_resetForTests cleared prior stepOutputs; fresh run derives correctly')
    : bad(`cleanEditor=${JSON.stringify(cleanEditor)}`);
  pipeSvc.signalStepTerminal(cleanRunId, 1, 'complete', { produced_artifact_ids: ['done'] });
  await cleanPromise;

  // ---- 12c. PipelineFlow: 2.0 #1 留口 flow engine rewiring (real subagent drive) ----
  console.log('\n[12c/19] PipelineFlow (2.0 #1 留口 real subagent drive)');
  pipeSvc._resetForTests();
  memberSvc._resetForTests();
  // Build a mock ctx that records followup + startContinuable calls (same
  // pattern as the [9j] / [9h] tests). The flow's `dispatchTask` helper
  // sees `ctx.subagents.followup` and routes to MemberService.dispatch
  // (which writes the dispatch-log row AND fires followup).
  const followupCalls3 = [];
  const startCalls3 = [];
  const interruptCalls3 = [];
  const ctxPipeRe = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        startCalls3.push(spec);
        return { childId: `child-pipe-${startCalls3.length}-${Date.now().toString(36)}`, messageId: `msg-pipe-${startCalls3.length}` };
      },
      followup: async (parent, childId, content, options) => {
        followupCalls3.push({ parent, childId, content, options });
        return `fup-pipe-${followupCalls3.length}`;
      },
      interrupt: async (targetSessionId, authority) => {
        interruptCalls3.push({ targetSessionId, authority });
      },
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
    parent: { id: 'agent-scheduler', session: { id: 'sess-sched' } },
  };
  const reMeta = await ts.start({
    taskDescription: 'rewired pipeline',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'brain', task: 'first', intent: 'produce' },
        { member_id: 'critic', task: 'second', intent: 'review' },
      ],
    },
    members: [
      { member_id: 'brain', instance_alias: 'b' },
      { member_id: 'critic', instance_alias: 'c' },
    ],
  });
  const reRunId = reMeta.id;
  await ts.markHolder(reRunId);
  await ts.transition(reRunId, 'pending', 'assembling', 'team-formed');
  const reStartBefore = startCalls3.length;
  const reFollowupBefore = followupCalls3.length;
  const rePromise = flowSvc.run(reRunId, ctxPipeRe);
  await new Promise((r) => setTimeout(r, 100));
  // After 1st dispatch: the flow has dispatched step 0 (auto-joins brain +
  // fires followup) and is now waiting on the in-memory step terminal
  // signal. So we expect exactly +1 start (brain join) and +1 followup
  // (the dispatch followup to brain). Step 1's dispatch hasn't run yet.
  startCalls3.length === reStartBefore + 1
    ? ok('rewired pipeline: dispatchTask auto-joins step 0 member via startContinuable')
    : bad(`startCalls3 added=${startCalls3.length - reStartBefore} (expected 1)`);
  followupCalls3.length === reFollowupBefore + 1
    ? ok('rewired pipeline: dispatchTask calls followup on step 0 dispatch')
    : bad(`followupCalls3 added=${followupCalls3.length - reFollowupBefore} (expected 1)`);
  // Complete step 0 -> step 1's dispatch should auto-derive context_refs
  // from step 0's produced_artifact_ids (proves rewiring + #4 both work)
  const step0StartBefore = startCalls3.length;
  const step0FollowupBefore = followupCalls3.length;
  pipeSvc.signalStepTerminal(reRunId, 0, 'complete', { produced_artifact_ids: ['rewired-art'] });
  await new Promise((r) => setTimeout(r, 100));
  startCalls3.length === step0StartBefore + 1
    ? ok('rewired pipeline: after step 0 complete, step 1 auto-joins critic via startContinuable')
    : bad(`startCalls3 added=${startCalls3.length - step0StartBefore} (expected 1 for critic)`);
  followupCalls3.length === step0FollowupBefore + 1
    ? ok('rewired pipeline: after step 0 complete, step 1 dispatch fires followup')
    : bad(`followupCalls3 added=${followupCalls3.length - step0FollowupBefore} (expected 1)`);
  // The latest followup (step 1's) should have a content block referencing
  // 'rewired-art' (composeDispatchPrompt formats context_refs into the prompt)
  const lastFup = followupCalls3[followupCalls3.length - 1];
  const lastFupText = lastFup?.content?.[0]?.text ?? '';
  /rewired-art/.test(lastFupText)
    ? ok('rewired pipeline: step 1 followup prompt carries step 0 produced_artifact_ids (context_refs propagated to MemberService.dispatch)')
    : bad(`lastFup text=${JSON.stringify(lastFupText)}`);
  pipeSvc.signalStepTerminal(reRunId, 1, 'complete', { produced_artifact_ids: ['done-rewired'] });
  const reResult = await rePromise;
  reResult.terminal === 'succeeded' ? ok('rewired pipeline terminal: succeeded') : bad(`terminal=${reResult.terminal}`);
  // dispatch-log still has the single-writer rows (MemberService.dispatch
  // appends `from: scheduler, to: member, context_refs` per the contract)
  const reDl = readFileSync(join(paths.teamRunsDir, reRunId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const reSchedulerRows = reDl.filter((r) => r.from === 'scheduler' && (r.to === 'brain' || r.to === 'critic'));
  reSchedulerRows.length === 2
    ? ok('rewired pipeline: dispatch-log has 2 scheduler rows (single-writer contract preserved)')
    : bad(`reSchedulerRows.len=${reSchedulerRows.length}`);
  const reCriticRow = reSchedulerRows.find((r) => r.to === 'critic');
  Array.isArray(reCriticRow?.context_refs) && reCriticRow.context_refs.includes('rewired-art')
    ? ok('rewired pipeline: critic dispatch row carries derived context_refs')
    : bad(`reCriticRow=${JSON.stringify(reCriticRow)}`);
  // session-state.json for both members should show state=running (auto-joined)
  const reBrainSess = JSON.parse(readFileSync(join(paths.teamRunsDir, reRunId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  const reCriticSess = JSON.parse(readFileSync(join(paths.teamRunsDir, reRunId, 'sessions', 'critic', 'session-state.json'), 'utf-8'));
  reBrainSess.state === 'running' && reCriticSess.state === 'running'
    ? ok('rewired pipeline: both members have session-state.state=running after auto-join')
    : bad(`brain=${reBrainSess.state} critic=${reCriticSess.state}`);
  // dispatchTask standalone: smoke-test the helper directly with a mock ctx
  // to verify shape (no need to spin up a full run for this one)
  const dtCtx = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async () => ({ childId: 'c1', messageId: 'm1' }),
      followup: async () => 'f1',
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes'],
    },
    parent: { id: 'p' },
  };
  const dtRunId = 'pipe-dt-isolate';
  // Member lookup requires a real session-state.json, so we skip the actual
  // member service and verify dispatchTask fall-back to dispatchLog on no-subagent
  const dtFallback = await pipeSvc.dispatchTask(null, 'dt-fallback-run', 'fake-member', {
    task: 'fallback task', contextRefs: ['a'], seq: 7,
  });
  dtFallback && dtFallback.id && dtFallback.id.includes('dt-fallback-run')
    ? ok('dispatchTask falls back to dispatchLog when ctx has no subagents.followup')
    : bad(`dtFallback=${JSON.stringify(dtFallback)}`);
  // dispatchTask with subagents but no member catalog: memberService.dispatch
  // throws. Verify the error propagates rather than being swallowed.
  let dtError = null;
  try {
    await pipeSvc.dispatchTask(dtCtx, 'dt-err-run', 'no-such-member', {
      task: 'err task', contextRefs: [], seq: 1,
    });
  } catch (e) { dtError = e; }
  dtError && /no such member|unknown member|no session-state/.test(String(dtError.message))
    ? ok('dispatchTask propagates memberService errors (no swallow) when subagent path fails')
    : bad(`dtError=${dtError?.message}`);
  void dtRunId;

  // ---- 12d. RoundTableFlow: 2.0 #1 留口 real subagent drive ----
  console.log('\n[12d/19] RoundTableFlow (2.0 #1 留口 real subagent drive)');
  const rtSvc = await importService('services/round-table-flow.js');
  msgSvc._resetForTests();
  memberSvc._resetForTests();
  const ctxRt = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async () => ({ childId: 'rt-child', messageId: 'rt-msg' }),
      followup: async () => 'rt-fup',
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
    parent: { id: 'p' },
  };
  // dispatchTask fallback (no subagents)
  const rtFallback = await rtSvc.dispatchTask(null, 'rt-fb', 'fake', { task: 't', contextRefs: [], seq: 1 });
  rtFallback && rtFallback.id
    ? ok('round-table dispatchTask falls back to dispatchLog when ctx has no subagents')
    : bad(`rtFallback=${JSON.stringify(rtFallback)}`);

  // ---- 12e. FanOutFlow: 2.0 #1 留口 real subagent drive ----
  console.log('\n[12e/19] FanOutFlow (2.0 #1 留口 real subagent drive)');
  const foSvcRewire = await importService('services/fan-out-flow.js');
  foSvcRewire._resetForTests();
  dpSvc._resetForTests();
  memberSvc._resetForTests();

  // ---- 12f. team.start tool: __dshCtx closure-capture (flow engine rewiring wire) ----
  console.log('\n[12f/19] team.start tool wraps ctx as args.__dshCtx');
  // Verify the tool's execute reads `args.__dshCtx` and passes it to flowSvc.run.
  // We invoke the tool's execute directly with a mock ctx; the flow engine will
  // be kicked off, dispatchTask will use memberService.dispatch, and we
  // verify the followup / start calls were made against our mock ctx.
  const { teamTools } = await importService('lib/tools/team-tools.js');
  const teamStart = teamTools.find((t) => t.name === 'team.start');
  teamStart && teamStart.execute
    ? ok('team.start tool is registered with an execute function')
    : bad('team.start missing execute');
  // Build a mock ctx and call team.start.execute with __dshCtx
  const startFup = [];
  const startStart = [];
  const capturedCtx = { sentinel: 'this-is-the-ctx' };
  const ctxForTool = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        startStart.push({ spec, ctx: capturedCtx });
        return { childId: `ts-${startStart.length}-${Date.now().toString(36)}`, messageId: `tsm-${startStart.length}` };
      },
      followup: async () => {
        startFup.push('fup');
        return 'fup-ts';
      },
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes'],
    },
    parent: { id: 'tool-sched' },
    ...capturedCtx,
  };
  // team.start.execute expects only the args shape; we add __dshCtx manually
  // to mirror what the lib/index.js wrapper does at registration time.
  const toolRunMeta = await teamStart.execute({
    taskDescription: 'team.start tool test',
    flow: 'pipeline-with-feedback',
    flowConfig: {
      steps: [
        { member_id: 'brain', task: 'only step', intent: 'produce' },
      ],
    },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
    __dshCtx: ctxForTool,
  });
  toolRunMeta && toolRunMeta.runId && toolRunMeta.state === 'pending'
    ? ok('team.start.execute returns runId + state=pending')
    : bad(`toolRunMeta=${JSON.stringify(toolRunMeta)}`);
  // Give the flow engine a moment to dispatch step 0
  await new Promise((r) => setTimeout(r, 200));
  // startStart should have grown (flow dispatched step 0 -> auto-join brain)
  startStart.length >= 1
    ? ok('team.start.execute → flowSvc.run → dispatchTask → MemberService.dispatch → ctx.subagents.startContinuable fired')
    : bad(`startStart.len=${startStart.length}`);
  startFup.length >= 1
    ? ok('team.start.execute → flow engine fired followup on the dispatched member')
    : bad(`startFup.len=${startFup.length}`);
  // Clean up: signal the step so the run reaches terminal and cleans up
  pipeSvc.signalStepTerminal(toolRunMeta.runId, 0, 'complete', { produced_artifact_ids: ['ts-art'] });
  await new Promise((r) => setTimeout(r, 100));
  const ctxFo = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => ({ childId: `fo-${Date.now()}`, messageId: `fo-msg-${Date.now()}` }),
      followup: async () => 'fo-fup',
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
    parent: { id: 'p' },
  };
  // dispatchTask fallback
  const foFallback = await foSvcRewire.dispatchTask(null, 'fo-fb', 'fake', { task: 't', contextRefs: [], seq: 1 });
  foFallback && foFallback.id
    ? ok('fan-out dispatchTask falls back to dispatchLog when ctx has no subagents')
    : bad(`foFallback=${JSON.stringify(foFallback)}`);
  // Full rewired fan-out: 2 parallel branches + aggregator, mock ctx with
  // recording followup. Verify auto-join, followup, aggregator context_refs.
  const followupFo = [];
  const startFo = [];
  const ctxFoFull = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        startFo.push(spec);
        return { childId: `fo-c-${startFo.length}-${Date.now().toString(36)}`, messageId: `fo-m-${startFo.length}` };
      },
      followup: async (parent, childId, content) => {
        followupFo.push({ parent, childId, content });
        return `fup-fo-${followupFo.length}`;
      },
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes'],
    },
    parent: { id: 'fo-sched' },
  };
  const foReMeta = await ts.start({
    taskDescription: 'rewired fan-out',
    flow: 'fan-out-collect',
    flowConfig: {
      parallel: [
        { member_id: 'brain', task: 'lookup a' },
        { member_id: 'critic', task: 'lookup b' },
      ],
      aggregator: { member_id: 'brain', task: 'merge results' },
    },
    members: [
      { member_id: 'brain', instance_alias: 'b' },
      { member_id: 'critic', instance_alias: 'c' },
    ],
  });
  const foReId = foReMeta.id;
  await ts.markHolder(foReId);
  await ts.transition(foReId, 'pending', 'assembling', 'team-formed');
  const foRePromise = flowSvc.run(foReId, ctxFoFull);
  await new Promise((r) => setTimeout(r, 100));
  // 2 parallel branches auto-join + 2 followups
  startFo.length === 2 ? ok('rewired fan-out: 2 parallel branches auto-join via startContinuable') : bad(`startFo.len=${startFo.length}`);
  followupFo.length === 2 ? ok('rewired fan-out: 2 parallel branch dispatches fire followup') : bad(`followupFo.len=${followupFo.length}`);
  foSvcRewire.signalBranchTerminal(foReId, 'brain', 'complete', { produced_artifact_ids: ['a1'] });
  foSvcRewire.signalBranchTerminal(foReId, 'critic', 'complete', { produced_artifact_ids: ['b1'] });
  await new Promise((r) => setTimeout(r, 100));
  // Aggregator should have reused the existing brain session (no new start)
  // and fired one followup for the merge task with the completed artifacts
  // as context_refs.
  followupFo.length === 3 ? ok('rewired fan-out: aggregator dispatch fires followup on reused session') : bad(`followupFo after branches=${followupFo.length}`);
  // The aggregator followup prompt should carry the completed artifacts
  const aggFup = followupFo[followupFo.length - 1];
  const aggText = aggFup?.content?.[0]?.text ?? '';
  /a1/.test(aggText) && /b1/.test(aggText)
    ? ok('rewired fan-out: aggregator followup prompt carries completed_members.artifacts (context_refs propagated)')
    : bad(`aggText=${JSON.stringify(aggText)}`);
  foSvcRewire.signalBranchTerminal(foReId, 'brain', 'complete', { produced_artifact_ids: ['merged'] });
  const foReResult = await foRePromise;
  foReResult.terminal === 'succeeded' ? ok('rewired fan-out terminal: succeeded (2 parallel + aggregator)') : bad(`terminal=${foReResult.terminal}`);

  // ---- 13. FanOut happy path: 2 branches, no pre-flight, both complete ----
  console.log('\n[13/19] FanOut (happy path)');
  const foSvc = await importService('services/fan-out-flow.js');
  foSvc._resetForTests();
  const foMeta = await ts.start({
    taskDescription: 'fan-out happy',
    flow: 'fan-out-collect',
    flowConfig: {
      parallel: [
        { member_id: 'a', task: 'lookup a' },
        { member_id: 'b', task: 'lookup b' },
      ],
    },
    members: [
      { member_id: 'a', instance_alias: 'alpha' },
      { member_id: 'b', instance_alias: 'beta' },
    ],
  });
  const foRunId = foMeta.id;
  await ts.markHolder(foRunId);
  await ts.transition(foRunId, 'pending', 'assembling', 'team-formed');
  const foPromise = flowSvc.run(foRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  foSvc.signalBranchTerminal(foRunId, 'a', 'complete', { produced_artifact_ids: ['a1'] });
  foSvc.signalBranchTerminal(foRunId, 'b', 'complete', { produced_artifact_ids: ['b1'] });
  const foResult = await foPromise;
  foResult.terminal === 'succeeded' ? ok('fan-out happy: 2 branches complete -> succeeded') : bad(`terminal=${foResult.terminal}`);
  const foFinal = await ts.readMeta(foRunId);
  foFinal.state === 'succeeded' ? ok('fan-out meta.state=succeeded') : bad(`state=${foFinal.state}`);
  foFinal.degraded_flag === false ? ok('fan-out degraded_flag=false when all complete') : bad(`degraded=${foFinal.degraded_flag}`);

  // ---- 14. FanOut partial: 3 branches, 1 fails -> succeeded(partial, degraded) ----
  console.log('\n[14/19] FanOut (partial)');
  foSvc._resetForTests();
  dpSvc._resetForTests();
  const fpMeta = await ts.start({
    taskDescription: 'fan-out partial',
    flow: 'fan-out-collect',
    flowConfig: {
      parallel: [
        { member_id: 'a', task: 'lookup a' },
        { member_id: 'b', task: 'lookup b' },
        { member_id: 'c', task: 'lookup c' },
      ],
    },
    members: [
      { member_id: 'a', instance_alias: 'alpha' },
      { member_id: 'b', instance_alias: 'beta' },
      { member_id: 'c', instance_alias: 'gamma' },
    ],
  });
  const fpRunId = fpMeta.id;
  await ts.markHolder(fpRunId);
  await ts.transition(fpRunId, 'pending', 'assembling', 'team-formed');
  const fpPromise = flowSvc.run(fpRunId, null);
  // 3 branches -> pre-flight DP. Wait for it to open.
  await new Promise((r) => setTimeout(r, 100));
  const preFlightDp = dpSvc.waitingDecisions(fpRunId).find((d) => d.kind === 'ad-hoc');
  preFlightDp ? ok('pre-flight DP opened for 3+ branch fan-out') : bad('no pre-flight DP');
  if (preFlightDp) {
    await dpSvc.respond(preFlightDp.id, { action: 'continue' });
    await new Promise((r) => setTimeout(r, 100));
  }
  // Now signal 2 complete + 1 fail
  foSvc.signalBranchTerminal(fpRunId, 'a', 'complete', { produced_artifact_ids: ['a1'] });
  foSvc.signalBranchTerminal(fpRunId, 'b', 'complete', { produced_artifact_ids: ['b1'] });
  foSvc.signalBranchTerminal(fpRunId, 'c', 'fail', { feedback: 'no data' });
  await fpPromise;
  const fpFinal = await ts.readMeta(fpRunId);
  fpFinal.state === 'succeeded' ? ok('partial: 2/3 complete -> succeeded') : bad(`state=${fpFinal.state}`);
  fpFinal.degraded_flag === true ? ok('partial: degraded_flag=true (≥1 非全部失败)') : bad(`degraded=${fpFinal.degraded_flag}`);

  // ---- 15. FanOut pre-flight cancel: 3 branches, DP abort -> aborted ----
  console.log('\n[15/19] FanOut (pre-flight cancel)');
  foSvc._resetForTests();
  dpSvc._resetForTests();
  const fcMeta = await ts.start({
    taskDescription: 'fan-out pre-flight cancel',
    flow: 'fan-out-collect',
    flowConfig: {
      parallel: [
        { member_id: 'a', task: 'lookup a' },
        { member_id: 'b', task: 'lookup b' },
        { member_id: 'c', task: 'lookup c' },
      ],
    },
    members: [
      { member_id: 'a', instance_alias: 'alpha' },
      { member_id: 'b', instance_alias: 'beta' },
      { member_id: 'c', instance_alias: 'gamma' },
    ],
  });
  const fcRunId = fcMeta.id;
  await ts.markHolder(fcRunId);
  await ts.transition(fcRunId, 'pending', 'assembling', 'team-formed');
  const fcPromise = flowSvc.run(fcRunId, null);
  await new Promise((r) => setTimeout(r, 100));
  const preDp = dpSvc.waitingDecisions(fcRunId).find((d) => d.kind === 'ad-hoc');
  if (preDp) {
    await dpSvc.respond(preDp.id, { action: 'abort', feedback: 'too expensive' });
    const fcResult = await fcPromise;
    fcResult.terminal === 'aborted' ? ok('pre-flight abort -> aborted') : bad(`terminal=${fcResult.terminal}`);
  } else {
    bad('pre-flight DP not found for fan-out 3 branches');
  }

  // ---- 16. PlanService: generate + get + list ----
  console.log('\n[16/19] PlanService');
  const planSvc = await importService('services/plan-service.js');
  planSvc._resetForTests();
  const planRunMeta = await ts.start({
    taskDescription: 'plan test',
    flow: 'pipeline-with-feedback',
    flowConfig: { steps: [{ member_id: 'writer', task: 'write' }] },
    members: [{ member_id: 'writer', instance_alias: 'w' }],
  });
  const planRunId = planRunMeta.id;
  await ts.markHolder(planRunId);
  const plan = await planSvc.generate({
    runId: planRunId,
    derivedFrom: ['user-intervention-log:dp-1'],
    body: 'plan body content',
    steps: [
      { role: 'writer', intent: 'produce', expected_artifact: { type: 'doc', desc: 'first draft' } },
      { role: 'editor', intent: 'review', expected_artifact: { type: 'doc', desc: 'reviewed draft' } },
    ],
  });
  plan.id && /^plan-/.test(plan.id) ? ok('plan.generate returns a plan-<id>') : bad(`plan.id=${plan.id}`);
  plan.derived_from[0] === 'user-intervention-log:dp-1' ? ok('plan.derived_from preserved') : bad('derived_from mismatch');
  plan.steps[0].intent === 'produce' ? ok('plan.steps[0].intent=produce (OQ-1)') : bad(`intent=${plan.steps[0].intent}`);
  plan.steps[1].intent === 'review' ? ok('plan.steps[1].intent=review (OQ-1)') : bad(`intent=${plan.steps[1].intent}`);
  // get + list
  const fetched = await planSvc.get(plan.id);
  fetched?.body === 'plan body content' ? ok('plan.get() returns the same body') : bad('get mismatch');
  const list = await planSvc.list(planRunId);
  list.length === 1 && list[0].id === plan.id ? ok('plan.list() returns 1 plan') : bad(`list.len=${list.length}`);
  // invalid intent rejected
  let invalidCaught = false;
  try {
    await planSvc.generate({ runId: planRunId, derivedFrom: ['x'], body: 'b', steps: [{ role: 'r', intent: 'bogus', expected_artifact: { type: 't', desc: 'd' } }] });
  } catch (e) { invalidCaught = /invalid intent/.test(String(e.message)); }
  invalidCaught ? ok('invalid intent rejected') : bad('invalid intent accepted');

  // ---- 17. ArtifactRegistry: register + cross-Run ref + canDelete ----
  console.log('\n[17/19] ArtifactRegistry');
  const artSvc = await importService('services/artifact-registry.js');
  const artRun1 = ts.newRunId();
  await ts.start({ taskDescription: 'a1', flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }] });
  // Use existing meta id by re-reading
  // (simpler: re-issue a fresh start and grab the id)
  // Actually start() generates its own id; we already have planRunId above.
  // Use the planRunId as our "run 1".
  const a1 = await artSvc.register({
    id: 'a-1', run_id: planRunId, type: 'doc', file: 'sessions/writer/artifacts/a-1.md',
    produced_by: 'writer', member_id: 'writer', derived_from: [],
  });
  a1.id === 'a-1' ? ok('register(a-1) ok') : bad('a1 mismatch');
  // Idempotent: re-register returns the same entry
  const a1b = await artSvc.register({ id: 'a-1', run_id: planRunId, type: 'doc', file: 'x', produced_by: 'y', derived_from: [] });
  a1b.id === a1.id && a1b.file === a1.file ? ok('register is idempotent (immutable snapshot)') : bad('re-register mutated');
  // canDelete: no refs -> true
  (await artSvc.canDelete(`${planRunId}/a-1`)) ? ok('canDelete=true with no refs') : bad('canDelete should be true');
  // Register another artifact that depends on a-1
  const planRun2Meta = await ts.start({
    taskDescription: 'a2', flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }],
  });
  const planRun2Id = planRun2Meta.id;
  await ts.markHolder(planRun2Id);
  await artSvc.register({
    id: 'a-2', run_id: planRun2Id, type: 'doc', file: 'sessions/m/artifacts/a-2.md',
    produced_by: 'm', member_id: 'm',
    derived_from: [`${planRunId}/a-1`],  // cross-Run ref
  });
  (await artSvc.refCount(`${planRunId}/a-1`)) === 1 ? ok('refCount=1 with one cross-Run ref') : bad('refCount mismatch');
  (await artSvc.canDelete(`${planRunId}/a-1`)) === false ? ok('canDelete=false when referenced') : bad('canDelete should be false');
  // list returns both runs' artifacts
  const artList1 = await artSvc.list(planRunId);
  const artList2 = await artSvc.list(planRun2Id);
  artList1.length === 1 && artList2.length === 1 ? ok('list per run returns correct counts') : bad('list shape wrong');

  // ---- 17b. ArtifactRegistry: 2.0 #2 O(1) refCount index ----
  console.log('\n[17b/19] ArtifactRegistry (2.0 #2 O(1) refCount index)');
  artSvc._resetIndexForTests();
  // Build a fresh cross-Run scenario: run A has artifact a-1; runs B/C/D
  // each register a consumer that references a-1 in derived_from.
  const idxAMeta = await ts.start({ taskDescription: 'idx-a', flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }] });
  const idxAId = idxAMeta.id;
  await artSvc.register({
    id: 'idx-a-1', run_id: idxAId, type: 'doc', file: 'sessions/m/artifacts/idx-a-1.md',
    produced_by: 'm', member_id: 'm', derived_from: [],
  });
  // Three consumer runs, each with a derived_from pointing at a-1
  for (let i = 0; i < 3; i++) {
    const cmeta = await ts.start({ taskDescription: `idx-c-${i}`, flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }] });
    await ts.markHolder(cmeta.id);
    await artSvc.register({
      id: `idx-c-${i}`, run_id: cmeta.id, type: 'doc', file: `sessions/m/artifacts/idx-c-${i}.md`,
      produced_by: 'm', member_id: 'm', derived_from: [`${idxAId}/idx-a-1`],
    });
  }
  // refCount with the canonical form: 3 distinct consumer artifacts
  (await artSvc.refCount(`${idxAId}/idx-a-1`)) === 3
    ? ok('refCount returns 3 for canonical cross-Run form (3 distinct consumers)')
    : bad(`refCount canonical=${await artSvc.refCount(`${idxAId}/idx-a-1`)}`);
  // canDelete: false (3 refs)
  (await artSvc.canDelete(`${idxAId}/idx-a-1`)) === false
    ? ok('canDelete=false when 3 cross-Run refs exist')
    : bad('canDelete should be false');
  // Register a 4th consumer that references a-1 in TWO ways (canonical + bare)
  // -> should still count as 1 (intra-artifact dedup, matching v1.0 semantics)
  const cmeta4 = await ts.start({ taskDescription: 'idx-c-4', flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }] });
  await ts.markHolder(cmeta4.id);
  await artSvc.register({
    id: 'idx-c-4', run_id: cmeta4.id, type: 'doc', file: 'sessions/m/artifacts/idx-c-4.md',
    produced_by: 'm', member_id: 'm',
    derived_from: [`${idxAId}/idx-a-1`, 'idx-a-1'],  // both forms
  });
  (await artSvc.refCount(`${idxAId}/idx-a-1`)) === 4
    ? ok('refCount handles cross-form refs in same artifact (still 1 per artifact)')
    : bad(`refCount after dup-form=${await artSvc.refCount(`${idxAId}/idx-a-1`)}`);
  // Idempotent re-register: same id, same derived_from -> refCount unchanged
  const c0List = await ts.list();
  const c0Id = c0List.find((r) => r.task_description === 'idx-c-0')?.id;
  if (c0Id) {
    await artSvc.register({
      id: 'idx-c-0', run_id: c0Id, type: 'doc', file: 'sessions/m/artifacts/idx-c-0.md',
      produced_by: 'm', member_id: 'm', derived_from: [`${idxAId}/idx-a-1`],
    });
    (await artSvc.refCount(`${idxAId}/idx-a-1`)) === 4
      ? ok('refCount unchanged after idempotent re-register of an existing consumer')
      : bad(`refCount after re-register=${await artSvc.refCount(`${idxAId}/idx-a-1`)}`);
  }
  // _resetIndexForTests: clear and the next refCount rebuilds from disk
  artSvc._resetIndexForTests();
  (await artSvc.refCount(`${idxAId}/idx-a-1`)) === 4
    ? ok('_resetIndexForTests triggers a rebuild from disk; refCount is restored')
    : bad(`refCount after reset=${await artSvc.refCount(`${idxAId}/idx-a-1`)}`);
  // Unknown ref: refCount 0
  (await artSvc.refCount('run-no-such/idx-no-such')) === 0
    ? ok('refCount=0 for unknown ref')
    : bad('refCount should be 0 for unknown ref');
  artSvc._resetIndexForTests();

  // ---- 17c. ArtifactRegistry: O(1) is actually fast (scaling sanity) ----
  console.log('\n[17c/19] ArtifactRegistry (2.0 #2 scaling sanity)');
  artSvc._resetIndexForTests();
  // Create a moderate number of runs + consumers; refCount should be sub-ms.
  const scalingRuns = 20;
  const consumersPerRun = 5;
  let scalingTarget = null;
  for (let r = 0; r < scalingRuns; r++) {
    const rmeta = await ts.start({ taskDescription: `scaling-${r}`, flow: 'handoff-round-table', flowConfig: {}, members: [{ member_id: 'm', instance_alias: 'm' }] });
    await ts.markHolder(rmeta.id);
    if (scalingTarget === null) {
      // First run: register the target artifact
      await artSvc.register({
        id: `scaling-target`, run_id: rmeta.id, type: 'doc', file: 'sessions/m/artifacts/scaling-target.md',
        produced_by: 'm', member_id: 'm', derived_from: [],
      });
      scalingTarget = `${rmeta.id}/scaling-target`;
      continue;
    }
    for (let c = 0; c < consumersPerRun; c++) {
      await artSvc.register({
        id: `scaling-c-${r}-${c}`, run_id: rmeta.id, type: 'doc', file: `sessions/m/artifacts/scaling-c-${r}-${c}.md`,
        produced_by: 'm', member_id: 'm', derived_from: [scalingTarget],
      });
    }
  }
  // Expected count: 19 runs * 5 consumers = 95 refs
  const expectedRefs = (scalingRuns - 1) * consumersPerRun;
  const startMs = Date.now();
  const actualCount = await artSvc.refCount(scalingTarget);
  const elapsedMs = Date.now() - startMs;
  actualCount === expectedRefs
    ? ok(`refCount scales correctly: ${actualCount} refs (expected ${expectedRefs})`)
    : bad(`refCount=${actualCount} expected=${expectedRefs}`);
  elapsedMs < 50
    ? ok(`refCount is fast: ${elapsedMs}ms (under 50ms threshold for ${expectedRefs} refs)`)
    : bad(`refCount slow: ${elapsedMs}ms`);

  // ---- 18. Adapter registry: 3 closed + unknown throws ----
  console.log('\n[18/19] Adapter registry');
  const { listAdapterIds, getAdapter } = await importService('services/adapters.js');
  const adapterIds = listAdapterIds();
  adapterIds.length === 3 && adapterIds.includes('hermes') && adapterIds.includes('mcode') && adapterIds.includes('claude-code')
    ? ok('listAdapterIds returns the closed set')
    : bad(`adapterIds=${JSON.stringify(adapterIds)}`);
  const hermes = getAdapter('hermes');
  hermes.provider === 'acp-hermes' && hermes.exec === 'hermes'
    ? ok('hermes -> acp-hermes (provider/exec match)')
    : bad(`hermes=${JSON.stringify(hermes)}`);
  const claude = getAdapter('claude-code');
  claude.provider === 'acp-claude-code' && claude.exec === 'claude-agent-acp'
    ? ok('claude-code -> acp-claude-code (bridge via claude-agent-acp)')
    : bad(`claude=${JSON.stringify(claude)}`);
  let unknownCaught = false;
  try { getAdapter('opencode'); } catch (e) { unknownCaught = /unknown adapter/.test(String(e.message)); }
  unknownCaught ? ok('unknown adapter rejected (closed set)') : bad('opencode should be rejected');

  // ---- 19. team.rerun: clone + inject + start fresh flow ----
  console.log('\n[19/19] team.rerun');
  // Source: a completed round-table run with an artifact we can inject
  pipeSvc._resetForTests();
  const rsrcMeta = await ts.start({
    taskDescription: 'rerun source',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const rsrcId = rsrcMeta.id;
  await ts.markHolder(rsrcId);
  await ts.transition(rsrcId, 'pending', 'assembling', 'ready');
  await ts.transition(rsrcId, 'assembling', 'running', 'go');
  await ts.transition(rsrcId, 'running', 'succeeded', 'done', { ended_at: new Date().toISOString() });
  // Register a source artifact
  await artSvc.register({
    id: 'src-1', run_id: rsrcId, type: 'doc', file: 'sessions/brain/artifacts/src-1.md',
    produced_by: 'brain', member_id: 'brain', derived_from: [],
  });
  // Now rerun, injecting the source artifact
  const newRunMeta = await ts.start({
    taskDescription: 'rerun clone', flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  // emulate team.rerun by direct call to teamService
  const source = await ts.readMeta(rsrcId);
  // Validate the input shape matches what team.rerun would do
  source.flow === 'handoff-round-table' && source.members.length === 1
    ? ok('source has expected flow + members for rerun')
    : bad('source shape wrong');
  newRunMeta.id !== rsrcId ? ok('new run has a fresh id') : bad('new run id collision');
  newRunMeta.state === 'pending' ? ok('new run starts at state=pending') : bad(`newRunMeta.state=${newRunMeta.state}`);

  // ---- 20. team.resume: interrupted -> assembling + rejoin + flow restart ----
  console.log('\n[20/19] team.resume (P1 #6)');
  memberSvc._resetForTests();
  pipeSvc._resetForTests();
  msgSvc._resetForTests();
  // Find team.resume in the tool list
  const teamResume = teamTools.find((t) => t.name === 'team.resume');
  teamResume && teamResume.execute
    ? ok('team.resume tool is registered with an execute function')
    : bad('team.resume missing execute');
  // 20a) Resume a non-existent run throws
  let notFoundErr = null;
  try {
    await teamResume.execute({ runId: 'definitely-does-not-exist' });
  } catch (e) { notFoundErr = e; }
  notFoundErr && /not found/.test(String(notFoundErr.message))
    ? ok('team.resume on a non-existent run throws "not found"')
    : bad(`notFoundErr=${notFoundErr?.message}`);
  // 20b) Set up an interrupted run: start a round-table run, simulate
  // an interrupt via reconcileOnBoot, then resume with a mock ctx.
  const resumeMeta = await ts.start({
    taskDescription: 'resume test',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [
      { member_id: 'brain', instance_alias: 'b' },
      { member_id: 'critic', instance_alias: 'c' },
    ],
  });
  const resumeId = resumeMeta.id;
  await ts.markHolder(resumeId);
  await writeJsonFile(join(paths.teamRunsDir, resumeId, 'holder.pid'), '999999');
  await ts.transition(resumeId, 'pending', 'assembling', 'team-formed');
  await ts.transition(resumeId, 'assembling', 'running', 'flow-started');
  // Force a "dead holder" by writing a foreign pid, then run reconcileOnBoot
  await writeJsonFile(join(paths.teamRunsDir, resumeId, 'holder.pid'), '999999');
  const reBootResult = await ts.reconcileOnBoot();
  reBootResult.interrupted.includes(resumeId)
    ? ok('reconcileOnBoot marked the run as interrupted (pre-resume)')
    : bad(`interrupted=${JSON.stringify(reBootResult.interrupted)}`);
  const interruptedMeta = await ts.readMeta(resumeId);
  interruptedMeta.state === 'interrupted'
    ? ok('pre-resume meta.state=interrupted')
    : bad(`pre-resume state=${interruptedMeta.state}`);
  // 20c) Resume with mock ctx that records startContinuable / followup.
  // The flow engine will re-run round-table which will try to dispatch
  // invites; we expect both members to be auto-joined and followup fired.
  const resumeStart = [];
  const resumeFollowup = [];
  const ctxResume = {
    on: () => () => {},
    emit: () => {},
    logger: { info() {}, warn() {} },
    subagents: {
      startContinuable: async (spec) => {
        resumeStart.push(spec);
        return { childId: `rs-c-${resumeStart.length}-${Date.now().toString(36)}`, messageId: `rs-m-${resumeStart.length}` };
      },
      followup: async (parent, childId, content) => {
        resumeFollowup.push({ parent, childId, content });
        return `rs-fup-${resumeFollowup.length}`;
      },
      interrupt: async () => {},
      getProvider: () => ({ name: 'acp-hermes' }),
      list: () => ['acp-hermes', 'acp-mcode', 'acp-claude-code'],
    },
    parent: { id: 'resume-sched' },
  };
  const resumeResult = await teamResume.execute({ runId: resumeId, reason: 'crash-recovery', __dshCtx: ctxResume });
  resumeResult.runId === resumeId
    ? ok('team.resume returns the original runId (not a clone)')
    : bad(`resumeResult.runId=${resumeResult.runId}`);
  resumeResult.state === 'assembling'
    ? ok('team.resume returns state=assembling after the transition')
    : bad(`resumeResult.state=${resumeResult.state}`);
  Array.isArray(resumeResult.reJoined) && resumeResult.reJoined.length === 2
    ? ok('team.resume reJoined both members (brain + critic)')
    : bad(`resumeResult.reJoined=${JSON.stringify(resumeResult.reJoined)}`);
  // The state machine should now show the assembling edge in state-history
  const resumeHist = readFileSync(join(paths.teamRunsDir, resumeId, 'state-history.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const resumeEdge = resumeHist.find((h) => h.from_state === 'interrupted' && h.to_state === 'assembling' && h.reason === 'crash-recovery');
  resumeEdge
    ? ok('state-history contains `interrupted -> assembling` edge with the user reason')
    : bad(`resumeHist edge missing`);
  // Give the flow engine a moment to dispatch the round-1 invites
  await new Promise((r) => setTimeout(r, 200));
  resumeStart.length === 2
    ? ok('team.resume re-launched flow engine: 2 members auto-joined via startContinuable')
    : bad(`resumeStart.len=${resumeStart.length}`);
  resumeFollowup.length === 2
    ? ok('team.resume re-launched flow engine: 2 invites fired followup')
    : bad(`resumeFollowup.len=${resumeFollowup.length}`);
  // session-state.json for both members should be state=running after re-join
  const reBrainSess20 = JSON.parse(readFileSync(join(paths.teamRunsDir, resumeId, 'sessions', 'brain', 'session-state.json'), 'utf-8'));
  const reCriticSess20 = JSON.parse(readFileSync(join(paths.teamRunsDir, resumeId, 'sessions', 'critic', 'session-state.json'), 'utf-8'));
  reBrainSess20.state === 'running' && reCriticSess20.state === 'running'
    ? ok('team.resume: both members session-state.state=running after re-join')
    : bad(`brain=${reBrainSess20.state} critic=${reCriticSess20.state}`);
  // dispatch-log: should have at least the member-join rows for both members
  const resumeDl = readFileSync(join(paths.teamRunsDir, resumeId, 'dispatch-log.jsonl'), 'utf-8').trim().split('\n').map((l) => JSON.parse(l));
  const resumeJoinRows = resumeDl.filter((r) => r.kind === 'member-join');
  resumeJoinRows.length === 2
    ? ok('team.resume dispatch-log: 2 member-join rows (one per re-join)')
    : bad(`resumeJoinRows.len=${resumeJoinRows.length}`);

  // 20d) Resume a non-interrupted run throws
  const liveMeta = await ts.start({
    taskDescription: 'live run',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const liveId = liveMeta.id;
  await ts.markHolder(liveId);
  await ts.transition(liveId, 'pending', 'assembling', 'team-formed');
  let liveErr = null;
  try {
    await teamResume.execute({ runId: liveId });
  } catch (e) { liveErr = e; }
  liveErr && /state=assembling|state=running|state=interrupted/.test(String(liveErr.message))
    ? ok('team.resume on a non-interrupted run throws with the actual state')
    : bad(`liveErr=${liveErr?.message}`);

  // 20e) No-op safety: resume on a fresh `assembling` run would throw the
  // same "state=..." error; the assembling edge is irreversible from the
  // test side, so the resume contract holds.
  // (already covered by 20d)

  // 20f) No __dshCtx (smoke-test scenario): resume falls back to v1.0
  // dispatchLog path. The flow engine runs to terminal through the legacy
  // test signal. We use a fresh run, mark interrupted, resume without ctx.
  const legacyMeta = await ts.start({
    taskDescription: 'legacy resume',
    flow: 'handoff-round-table',
    flowConfig: { max_rounds: 1 },
    members: [{ member_id: 'brain', instance_alias: 'b' }],
  });
  const legacyId = legacyMeta.id;
  await ts.markHolder(legacyId);
  await writeJsonFile(join(paths.teamRunsDir, legacyId, 'holder.pid'), '999999');
  await ts.transition(legacyId, 'pending', 'assembling', 'team-formed');
  await ts.transition(legacyId, 'assembling', 'running', 'flow-started');
  await writeJsonFile(join(paths.teamRunsDir, legacyId, 'holder.pid'), '999999');
  await ts.reconcileOnBoot();
  // No __dshCtx: the resume still works for state + dispatchLog fallback
  const legacyResume = await teamResume.execute({ runId: legacyId });
  legacyResume.state === 'assembling'
    ? ok('team.resume works without __dshCtx (state transition + re-join only; dispatch falls back to dispatchLog)')
    : bad(`legacyResume.state=${legacyResume.state}`);

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
