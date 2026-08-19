/**
 * fan-out-flow.js — Story 3 flow (fan-out-collect).
 *
 * Per architecture.md §4.7.3 + requirements.md §3.3:
 *   - 预飞行确认: len(parallel) >= 3 时开 ad-hoc DP 让用户确认成本
 *   - 并行派发 (物理 ≤4 worker): Promise.allSettled with concurrency cap
 *   - aggregator: 派发一个 member 收 completed 的 artifacts
 *   - 失败处理: 部分失败 -> degraded flag (不直接 failed);
 *     全部失败 -> failed;全部成功 -> succeeded
 *   - 决策点超时: §9.10.4 -> continue
 *
 * v1.0 simplified:
 *   - branch terminal 由 DSH 通过 team.complete_branch / team.fail_branch
 *     工具显式提供 (类似 pipeline.complete_step)
 *   - 物理并发 cap = 4 是 const (直接引用宿主 ACP adapter §9.12.9)
 *
 * @module dsh-team-plugin/fan-out-flow
 */
import { readMeta, transition, writeMeta, setDegraded } from './team-service.js';
import { dispatch as dispatchLog, markTerminal as markDispatchTerminal, handoff as handoffLog } from './dispatch-service.js';
import { open as openDp, get as getDp } from './decision-point-service.js';

/** Hard cap on physical concurrency. Per architecture §9.12.9, this is
 * the ACP adapter ThreadPoolExecutor size (NOT a plugin-level decision). */
const PHYSICAL_CONCURRENCY_CAP = 4;

/** Pre-flight confirmation threshold. Per §9.13 ①. */
const PRE_FLIGHT_THRESHOLD = 3;

/** @type {Map<string, { resolve: (v: any) => void, info: { memberId: string } }>} */
const _branchWaiters = new Map();

/**
 * Signal a parallel branch's terminal state. Used by team.complete_branch /
 * team.fail_branch tools.
 * @param {string} runId
 * @param {string} memberId
 * @param {'complete'|'fail'} terminal
 * @param {{ produced_artifact_ids?: string[], feedback?: string }} [result]
 */
export function signalBranchTerminal(runId, memberId, terminal, result = {}) {
  const w = _branchWaiters.get(`${runId}::${memberId}`);
  if (!w) {
    _pendingSignals.set(`${runId}::${memberId}`, { terminal, result, at: new Date().toISOString() });
    return;
  }
  if (terminal === 'complete') {
    w.resolve({ kind: 'complete', memberId: w.info.memberId, produced_artifact_ids: result.produced_artifact_ids ?? [] });
  } else {
    w.resolve({ kind: 'fail', memberId: w.info.memberId, feedback: result.feedback ?? '' });
  }
  _branchWaiters.delete(`${runId}::${memberId}`);
}

const _pendingSignals = new Map();

function drainPendingSignal(runId, memberId) {
  const k = `${runId}::${memberId}`;
  const s = _pendingSignals.get(k);
  if (s) _pendingSignals.delete(k);
  return s ?? null;
}

/**
 * Run a fan-out-collect run to terminal.
 * @param {string} runId
 * @param {object} initialMeta
 * @param {object | null} ctx
 * @returns {Promise<{ terminal: 'succeeded'|'failed'|'aborted'|'interrupted' }>}
 */
export async function runFanOut(runId, initialMeta, ctx) {
  // assembling -> running
  let meta = await readMeta(runId);
  if (meta.state === 'assembling') {
    meta = await transition(runId, 'assembling', 'running', 'flow-started');
  }

  const parallel = Array.isArray(initialMeta.flow_config?.parallel) ? initialMeta.flow_config.parallel : [];
  const aggregator = initialMeta.flow_config?.aggregator;
  if (parallel.length === 0) {
    await transition(runId, 'running', 'failed', 'no-parallel-branches');
    return { terminal: 'failed' };
  }

  // ---- 预飞行确认 (§9.13 ①) ----
  if (parallel.length >= PRE_FLIGHT_THRESHOLD) {
    const dp = await openDp({
      runId,
      kind: 'ad-hoc',
      prompt: `将并行启动 ${parallel.length} 个成员 agent；是否继续?`,
      contextRefs: [],
      waitMinutes: 5,
    });
    while (true) {
      const fresh = getDp(dp.id);
      if (!fresh) break;
      if (fresh.status === 'responded') {
        if (fresh.response.action === 'abort' || fresh.response.action === 'complete') {
          await transition(runId, 'running', 'aborted', 'pre-flight-cancel');
          return { terminal: 'aborted' };
        }
        break; // continue
      }
      if (fresh.status === 'timed_out') {
        // §9.10.4: fan-out 超时 -> continue
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  // ---- 并行派发 (物理 ≤4) ----
  // 1) Log all member -> DSH-routing handoffs (start markers) sequentially
  let seq = 1;
  for (const p of parallel) {
    await handoffLog({
      run_id: runId,
      from: p.member_id,
      to: 'DSH-routing',
      task: 'fan-out start',
      reason: 'branch-start',
      seq: seq++,
    });
  }
  // 2) Dispatch to each member, await all (with cap = 4)
  // dispatchId -> memberId, so we can map markTerminal back to the branch
  const dispatchIdToMember = new Map();
  const dispatchArtifacts = new Map();
  const branchResults = new Map();
  let nextIndex = 0;
  const inFlight = new Set();
  while (nextIndex < parallel.length || inFlight.size > 0) {
    while (inFlight.size < PHYSICAL_CONCURRENCY_CAP && nextIndex < parallel.length) {
      const p = parallel[nextIndex++];
      const dispatched = await dispatchLog({
        run_id: runId,
        to: p.member_id,
        task: p.task,
        context_refs: p.context_refs ?? [],
        seq,
      });
      seq += 1;
      dispatchIdToMember.set(dispatched.id, p.member_id);
      const promise = waitForBranchTerminal(runId, p.member_id).then(async (sig) => {
        if (sig.kind === 'complete') {
          await markDispatchTerminal(runId, dispatched.id, 'completed', {
            produced_artifact_ids: sig.produced_artifact_ids,
          });
          branchResults.set(p.member_id, { kind: 'complete', produced_artifact_ids: sig.produced_artifact_ids ?? [] });
        } else {
          await markDispatchTerminal(runId, dispatched.id, 'failed', { feedback: sig.feedback });
          branchResults.set(p.member_id, { kind: 'fail', feedback: sig.feedback });
        }
        return sig;
      });
      inFlight.add(promise);
      promise.finally(() => inFlight.delete(promise));
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }
  // 3) Tally from in-memory branchResults (avoids re-parsing dispatch-log
  //    where markTerminal entries lack the `to` field).
  const completed = [];
  const failed = [];
  const completedArtifacts = [];
  for (const p of parallel) {
    const r = branchResults.get(p.member_id);
    if (!r) continue; // shouldn't happen
    if (r.kind === 'complete') {
      completed.push(p.member_id);
      if (r.produced_artifact_ids) completedArtifacts.push(...r.produced_artifact_ids);
    } else {
      failed.push(p.member_id);
    }
  }

  // ---- degraded flag (§8.3) ----
  if (failed.length > 0 && completed.length > 0) {
    await setDegraded(runId, `partial-fail:${failed.join(',')}`);
  }

  // ---- 终态判定 ----
  if (completed.length === 0) {
    // 全部失败 -> failed
    await transition(runId, 'running', 'failed', 'all-branches-failed');
    return { terminal: 'failed' };
  }

  // ---- aggregator 派发 (如果有) ----
  if (aggregator) {
    const dispatched = await dispatchLog({
      run_id: runId,
      to: aggregator.member_id,
      task: aggregator.task,
      context_refs: completedArtifacts,
      seq: seq++,
    });
    const sig = await waitForBranchTerminal(runId, aggregator.member_id);
    if (sig.kind === 'complete') {
      await markDispatchTerminal(runId, dispatched.id, 'completed', {
        produced_artifact_ids: sig.produced_artifact_ids,
      });
      branchResults.set(aggregator.member_id, { kind: 'complete', produced_artifact_ids: sig.produced_artifact_ids ?? [] });
    } else {
      await markDispatchTerminal(runId, dispatched.id, 'failed', { feedback: sig.feedback });
      // aggregator failed -> treat as degraded (partial)
      await setDegraded(runId, `aggregator-failed:${aggregator.member_id}`);
    }
  }

  // 至少 1 complete -> succeeded (partial if degraded)
  await transition(runId, 'running', 'succeeded', 'fan-out-collect-complete', {
    ended_at: new Date().toISOString(),
  });
  return { terminal: 'succeeded' };
}

function waitForBranchTerminal(runId, memberId) {
  const pending = drainPendingSignal(runId, memberId);
  if (pending) {
    return pending.terminal === 'complete'
      ? Promise.resolve({ kind: 'complete', memberId, produced_artifact_ids: pending.result.produced_artifact_ids ?? [] })
      : Promise.resolve({ kind: 'fail', memberId, feedback: pending.result.feedback ?? '' });
  }
  return new Promise((resolve) => {
    _branchWaiters.set(`${runId}::${memberId}`, { resolve, info: { memberId } });
  });
}

export function _resetForTests() {
  _branchWaiters.clear();
  _pendingSignals.clear();
}
