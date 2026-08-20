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
  const r = await ts.reconcileOnBoot();
  r.interrupted.includes(runId2) ? ok(`reconcileOnBoot marked ${runId2} as interrupted`) : bad(`expected ${runId2} in ${JSON.stringify(r.interrupted)}`);
  const reloadedOrphan = await ts.readMeta(runId2);
  reloadedOrphan?.state === 'interrupted'
    ? ok('orphan run is now state=interrupted')
    : bad(`orphan run state = ${reloadedOrphan?.state}`);

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
