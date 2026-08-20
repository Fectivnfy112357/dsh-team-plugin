/**
 * round-table-flow.js — Story 1 flow (handoff-round-table).
 *
 * Per architecture.md §4.7.1 + requirements.md §3.1:
 *   - 轮 = 邀请-回包对数（不依赖"全员发言"）
 *   - 轮次边界: 检收敛候选;有则开收敛门
 *   - max_rounds 到达: 开兜底门
 *   - 用户确认 complete -> succeeded (锚 user-intervention-log)
 *   - abort -> aborted
 *   - 超时按 flow 分流: round-table -> abort
 *
 * v1.0 simplification: we don't drive the subagent runtime — each round's
 * "邀请全部成员" is a logged dispatch to dispatch-log. The DSH LLM (or a
 * P1+ flow driver) reads these dispatches and feeds them into the actual
 * member sessions. The convergence + max_rounds + DP machinery is fully
 * implemented; the "DSH -> member prompt" transport is the missing piece.
 *
 * v2.0 #1 留口 (this revision) — flow engine rewiring:
 *   - 邀请派单经 `dispatchTask` helper:有 ctx.subagents 时走
 *     `MemberService.dispatch`(写 dispatch-log + 调 followup + auto-join),
 *     否则回退到 v1.0 纯日志路径
 *   - A2A system-wake 保留:inbox 投递仍由 `MessageService.send` 完成,
 *     跟 dispatchTask 是两条互补的轨迹(a2a-log 给 timeline,dispatch-log
 *     给 runtime 调度)
 *   - 唯一写入者承诺不变
 *
 * @module dsh-team-plugin/round-table-flow
 */
import { readMeta, transition } from './team-service.js';
import { dispatch as dispatchLog, markTerminal as markDispatchTerminal } from './dispatch-service.js';
import { send as sendA2A } from './message-service.js';
import { open as openDp, respond as respondDp, checkTimeouts, waitingDecisions, get as getDp } from './decision-point-service.js';
import { dispatch as memberDispatch } from './member-service.js';

/**
 * Drive a handoff-round-table run to terminal.
 * @param {string} runId
 * @param {object} initialMeta
 * @param {object | null} ctx
 * @returns {Promise<{ terminal: 'succeeded'|'failed'|'aborted'|'interrupted' }>}
 */
export async function runRoundTable(runId, initialMeta, ctx) {
  // Move assembling -> running if needed
  let meta = await readMeta(runId);
  if (meta.state === 'assembling') {
    meta = await transition(runId, 'assembling', 'running', 'flow-started');
  }

  const maxRounds = Math.max(1, Number(initialMeta.flow_config?.max_rounds ?? 5));

  for (let round = 0; round < maxRounds; round++) {
    // Re-read meta each round so current_round / degraded_flag reflect latest
    meta = await readMeta(runId);
    if (meta.state !== 'running') {
      return { terminal: meta.state };
    }

    // 1) 轮次边界: 检收敛候选 (scan a2a-message-log for payload.conclusion)
    const convergence = await checkConvergence(runId, meta, round);
    if (convergence) {
      const outcome = await handleDecisionGate(runId, ctx, 'convergence', convergence);
      if (outcome !== 'continue') return { terminal: outcome };
      continue; // continue = user said 'continue';下一轮 (feedback 已写入 inbox,流到下轮 prompt)
    }

    // 2) 向当前全部成员逐一发送发言邀请 (v2.0 #1 留口: ctx 透传,生产环境走
    //    MemberService.dispatch 真实驱动子代理;无 ctx 回退到 v1.0 纯日志)
    await inviteAllMembers(ctx, runId, meta, round);

    // 3) Wait for replies: in v1.0 there is no transport; we instead just
    //    let the DSH LLM observe the dispatch-log and either call
    //    messageService.send (members -> dispatch) or call team.complete
    //    directly. The engine yields by checking for any new messages
    //    before the next round. The poll interval is small for tests.
    // NOTE: a real implementation would await member completions here.

    // 4) Bump current_round in meta
    await bumpRound(runId, round + 1);
  }

  // max_rounds 到达: 兜底门
  const fallbackPrompt = '已达到 max_rounds 兜底门；请确认是否接受当前结果。';
  const outcome = await handleDecisionGate(runId, ctx, 'fallback', { prompt: fallbackPrompt, contextRefs: [] });
  return { terminal: outcome };
}

/**
 * Convergence check (architecture §9.9.6 / §4.5): scan the latest few
 * a2a-message-log entries for a `payload.conclusion` marker. v1.0 uses a
 * simple structural check; P2+ can swap in DSH LLM judgment if needed.
 *
 * @returns {Promise<{ prompt: string, contextRefs: string[] } | null>}
 */
async function checkConvergence(runId, meta, round) {
  const logPath = `${(await import('./paths.js')).getTeamPaths().teamRunsDir}/${runId}/a2a-message-log.jsonl`;
  const fs = await import('node:fs/promises');
  let text;
  try { text = await fs.readFile(logPath, 'utf-8'); }
  catch { return null; }
  const lines = text.trim().split('\n').filter(Boolean);
  // Look at the most recent 5 entries (cheap heuristic; P2+ can do better)
  const recent = lines.slice(-5);
  for (const ln of recent) {
    let entry;
    try { entry = JSON.parse(ln); } catch { continue; }
    if (entry?.payload?.conclusion && typeof entry.payload.conclusion === 'string') {
      return {
        prompt: `检测到收敛候选（来自 ${entry.from}）:\n${entry.payload.conclusion}`,
        contextRefs: entry.payload.artifact_ids ?? [],
      };
    }
  }
  return null;
}

/**
 * Open a decision point and wait synchronously for a response. In v1.0
 * "wait" means poll the registry at short intervals; the real transport
 * is the user clicking a button in the panel / typing in the timeline,
 * which the DSH LLM forwards via team.respond_decision_point.
 *
 * @returns {Promise<'succeeded'|'failed'|'aborted'|'interrupted'|'continue'>}
 */
async function handleDecisionGate(runId, ctx, kind, { prompt, contextRefs }) {
  const dp = await openDp({ runId, kind, prompt, contextRefs });
  // Poll for response. In production this awaits indefinitely (or until
  // DP.waitMinutes timeout); for v1.0 smoke tests we await completion
  // and rely on the test to call respondDp().
  while (true) {
    const fresh = getDp(dp.id);
    if (!fresh) return 'aborted';
    if (fresh.status === 'responded') {
      const action = fresh.response.action;
      if (action === 'complete') {
        await transition(runId, 'running', 'succeeded', 'user-confirmed-complete', {
          ended_at: new Date().toISOString(),
        });
        return 'succeeded';
      }
      if (action === 'abort') {
        await transition(runId, 'running', 'aborted', 'user-decision-abort');
        return 'aborted';
      }
      // continue: feedback (if any) is already in the user-intervention-log
      // and the next invite round will surface it via inbox + dispatch.task.
      return 'continue';
    }
    if (fresh.status === 'timed_out') {
      // Per architecture §9.10.4: round-table 超时 -> abort
      await transition(runId, 'running', 'aborted', 'decision-point-timeout');
      return 'aborted';
    }
    // busy-wait lite; tests bypass this with respondDp() before timeout
    await new Promise((r) => setTimeout(r, 50));
    // also check global timeouts (defensive; user-injected timers not used in v1.0)
    checkTimeouts();
  }
}

/**
 * Issue a task to a member. v2.0 #1 留口 flow engine rewiring:
 *   - If `ctx?.subagents?.followup` is available, drive the real subagent
 *     via `MemberService.dispatch` (writes dispatch-log + calls followup,
 *     auto-joins if the member isn't already running).
 *   - Otherwise (smoke-test / no-DSH-runtime) fall back to the v1.0
 *     `dispatchLog` which only writes the dispatch-log row.
 *
 * @param {any} ctx - DSH Cordis ctx (may be null for tests)
 * @param {string} runId
 * @param {string} memberId
 * @param {{
 *   task: string,
 *   contextRefs?: string[],
 *   seq: number,
 *   signal?: AbortSignal,
 * }} opts
 * @returns {Promise<{ id: string, joinedNow?: boolean, childId?: string }>}
 */
export async function dispatchTask(ctx, runId, memberId, opts) {
  if (ctx?.subagents?.followup) {
    const r = await memberDispatch(ctx, runId, memberId, {
      task: opts.task,
      contextRefs: opts.contextRefs ?? [],
      ...(ctx?.parent ? { parent: ctx.parent } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    return { id: r.dispatchId, joinedNow: r.joinedNow, childId: r.childId };
  }
  return dispatchLog({
    run_id: runId,
    to: memberId,
    task: opts.task,
    context_refs: opts.contextRefs ?? [],
    seq: opts.seq,
  });
}

/**
 * Log a dispatch to each member ("invite to speak"). v1.0 stub — there is
 * no subagent transport yet. The dispatch-log entries are what the panel
 * will render as the "first dispatch" / "round boundary" markers.
 *
 * v2.0 #1 留口 rewiring: in production, `ctx` carries a subagent runtime
 * and `dispatchTask` drives the real child via followup. The system-wake
 * A2A delivery stays regardless of path (it's the timeline-visible nudge;
 * the dedup window is 5s — fine for the per-round cadence).
 *
 * @param {any} ctx - DSH Cordis ctx (may be null for tests)
 */
async function inviteAllMembers(ctx, runId, meta, round) {
  let seq = 1;
  for (const m of meta.members) {
    await dispatchTask(ctx, runId, m.member_id, {
      task: `第 ${round + 1} 轮发言邀请`,
      contextRefs: [],
      seq: seq++,
    });
    // also drop a system-wake to the member's inbox (the wake dedup window
    // suppresses duplicate wakes within 5s — fine for our invite cadence)
    await sendA2A({
      runId,
      from: 'scheduler',
      to: m.member_id,
      topic: 'round-invite',
      intent: 'invite',
      kind: 'system-wake',
      payload: { round: round + 1 },
    });
  }
}

/** Bump current_round in meta.json. */
async function bumpRound(runId, next) {
  const { readMeta: read, writeJsonFile } = await import('./team-service.js');
  const m = await read(runId);
  if (!m) return;
  // local writeMeta via transition
  const { appendLog } = await import('./log-writer.js');
  await appendLog('state-history', runId, {
    from_state: 'running',
    to_state: 'running',
    reason: `round-bump:${next}`,
    timestamp: new Date().toISOString(),
  });
  await writeJsonFile(`${(await import('./paths.js')).getTeamPaths().teamRunsDir}/${runId}/meta.json`, { ...m, current_round: next });
}

export { checkConvergence };
