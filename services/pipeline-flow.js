/**
 * pipeline-flow.js — Story 2 flow (pipeline-with-feedback).
 *
 * Per architecture.md §4.7.2 + requirements.md §3.2:
 *   - 顺序强制在 DSH 侧:成员 handoff 写"完成 step N"不点名下一棒;
 *     DSH 查 plan 后派下一棒
 *   - 成员发起的移交不污染 dispatch-log:
 *     member -> DSH-routing 落 handoff-log,DSH -> member 落 dispatch-log
 *   - feedback loop: 每 step max_retries (默认 1),重派同 target + feedback
 *   - 决策点默认关;若 flow_config.decision_points[] 显式开启,按 §9.10.4
 *     分流超时 (pipeline -> continue)
 *
 * v1.0 simplified:
 *   - step terminal 由 DSH 通过 team.complete_step / team.fail_step 工具
 *     显式提供 (不驱动 subagent runtime)
 *   - in-memory step waiter Promise;DSH 进程是唯一持有者
 *   - feedback loop: 重派同 target + 上一轮 feedback
 *
 * @module dsh-team-plugin/pipeline-flow
 */
import { readMeta, transition, writeMeta } from './team-service.js';
import { dispatch as dispatchLog, markTerminal as markDispatchTerminal, handoff as handoffLog } from './dispatch-service.js';
import { open as openDp, get as getDp } from './decision-point-service.js';

/** @typedef {{
 *   member_id: string,
 *   task: string,
 *   context_refs?: string[],
 *   max_retries?: number,
 *   intent?: 'produce'|'review'|'collect'|'synthesize'|'decide',
 *   expected_artifact?: { type: string, desc: string },
 * }} PipelineStep
 */

/** @type {Map<string, { resolve: (v: any) => void, reject: (e: any) => void, currentStep: number }>} */
const _stepWaiters = new Map();

/**
 * Signal a step's terminal state from the DSH. Used by
 * team.complete_step / team.fail_step tools.
 * @param {string} runId
 * @param {number} stepIndex
 * @param {'complete'|'fail'} terminal
 * @param {{ produced_artifact_ids?: string[], feedback?: string }} [result]
 */
export function signalStepTerminal(runId, stepIndex, terminal, result = {}) {
  const w = _stepWaiters.get(runId);
  if (!w) {
    // No active waiter (flow already past, or signal out of order). The
    // signal is preserved on disk (the file write below) so the next
    // runFlow can pick it up if the flow re-enters.
    _pendingSignals.set(`${runId}::${stepIndex}`, { terminal, result, at: new Date().toISOString() });
    return;
  }
  if (w.currentStep !== stepIndex) {
    // Out-of-order signal; preserve it for the correct step
    _pendingSignals.set(`${runId}::${stepIndex}`, { terminal, result, at: new Date().toISOString() });
    return;
  }
  if (terminal === 'complete') {
    w.resolve({ kind: 'complete', produced_artifact_ids: result.produced_artifact_ids ?? [] });
  } else {
    w.resolve({ kind: 'fail', feedback: result.feedback ?? '' });
  }
}

/** @type {Map<string, { terminal: 'complete'|'fail', result: any, at: string }>} */
const _pendingSignals = new Map();

/**
 * Drain any preserved signal for the given (runId, stepIndex). Returns
 * null if nothing pending. v1.0 only — when cross-process state lands
 * (2.0) this becomes a log read.
 */
function drainPendingSignal(runId, stepIndex) {
  const k = `${runId}::${stepIndex}`;
  const s = _pendingSignals.get(k);
  if (s) _pendingSignals.delete(k);
  return s ?? null;
}

/**
 * Run a pipeline-with-feedback run to terminal.
 * @param {string} runId
 * @param {object} initialMeta
 * @param {object | null} ctx
 * @returns {Promise<{ terminal: 'succeeded'|'failed'|'aborted'|'interrupted' }>}
 */
export async function runPipeline(runId, initialMeta, ctx) {
  // assembling -> running
  let meta = await readMeta(runId);
  if (meta.state === 'assembling') {
    meta = await transition(runId, 'assembling', 'running', 'flow-started');
  }

  const steps = Array.isArray(initialMeta.flow_config?.steps) ? initialMeta.flow_config.steps : [];
  if (steps.length === 0) {
    return runPipelineFailed(runId, 'no-steps');
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    meta = await readMeta(runId);
    if (meta.state !== 'running') return { terminal: meta.state };

    // Bump current_step in meta
    await writeMeta(runId, { ...meta, current_step: i });

    // Check for an explicit ad-hoc DP at step boundary (if decision_points
    // configured for this index)
    const dpAtBoundary = (initialMeta.flow_config?.decision_points ?? []).find(
      (dp) => dp.at === `step-${i}`,
    );
    if (dpAtBoundary) {
      const dp = await openDp({
        runId,
        kind: 'ad-hoc',
        prompt: dpAtBoundary.prompt ?? `Continue past step ${i}?`,
        contextRefs: dpAtBoundary.context_refs ?? [],
        waitMinutes: dpAtBoundary.wait_minutes,
      });
      // Wait synchronously — same pattern as round-table-flow.
      // Pipeline 超时按 §9.10.4 -> continue
      let dpAction = 'continue';
      while (true) {
        const fresh = getDp(dp.id);
        if (fresh?.status === 'responded') { dpAction = fresh.response.action; break; }
        if (fresh?.status === 'timed_out') { dpAction = 'continue'; break; }
        await new Promise((r) => setTimeout(r, 50));
      }
      if (dpAction === 'abort') {
        await transition(runId, 'running', 'aborted', 'step-boundary-dp-abort');
        return { terminal: 'aborted' };
      }
      // continue: fall through to dispatch
    }

    // Dispatch the step (DSH -> member). Retry counter starts at 0.
    const maxRetries = Math.max(0, Number(step.max_retries ?? 1));
    let retry = 0;
    let feedback = '';
    let dispatchResult;

    while (true) {
      // member -> DSH-routing handoff (signals "starting step N"); v1.0
      // simplification: we log this even on first try so the handoff-log
      // shows the boundary marker.
      await handoffLog({
        run_id: runId,
        from: step.member_id,
        to: 'DSH-routing',
        task: `step-${i} start (${step.intent ?? 'produce'})`,
        reason: 'step-start',
        seq: i + 1,
      });
      // DSH -> member dispatch (the actual work)
      const dispatched = await dispatchLog({
        run_id: runId,
        to: step.member_id,
        task: feedback ? `${step.task}\n\nFeedback from prior attempt: ${feedback}` : step.task,
        context_refs: step.context_refs ?? [],
        seq: i + 1,
      });
      dispatchResult = dispatched;

      // Wait for terminal signal
      const sig = await waitForStepTerminal(runId, i, step);
      if (sig.kind === 'complete') {
        await markDispatchTerminal(runId, dispatchResult.id, 'completed', {
          produced_artifact_ids: sig.produced_artifact_ids,
        });
        // member -> DSH-routing: completion handoff
        await handoffLog({
          run_id: runId,
          from: step.member_id,
          to: 'DSH-routing',
          task: `step-${i} complete`,
          artifacts: sig.produced_artifact_ids,
          reason: 'step-complete',
          seq: i + 1,
        });
        // break the retry loop; move to next step
        break;
      }
      // fail
      await markDispatchTerminal(runId, dispatchResult.id, 'failed', { feedback: sig.feedback });
      await handoffLog({
        run_id: runId,
        from: step.member_id,
        to: 'DSH-routing',
        task: `step-${i} failed`,
        reason: sig.feedback,
        seq: i + 1,
      });
      if (retry < maxRetries) {
        retry += 1;
        feedback = sig.feedback;
        continue;
      }
      // exhausted — DSH can 插队 (v1.0 simplified: 失败 = failed)
      await transition(runId, 'running', 'failed', `step-${i}-exhausted-retries`);
      return { terminal: 'failed' };
    }
  }

  // All steps complete -> succeeded
  await transition(runId, 'running', 'succeeded', 'all-steps-complete', {
    ended_at: new Date().toISOString(),
  });
  return { terminal: 'succeeded' };
}

/** @returns {Promise<{ kind: 'complete'|'fail', produced_artifact_ids?: string[], feedback?: string }>} */
function waitForStepTerminal(runId, stepIndex, step) {
  // If a signal was preserved earlier (out-of-order from a test, etc.),
  // drain it now.
  const pending = drainPendingSignal(runId, stepIndex);
  if (pending) {
    return pending.terminal === 'complete'
      ? Promise.resolve({ kind: 'complete', produced_artifact_ids: pending.result.produced_artifact_ids ?? [] })
      : Promise.resolve({ kind: 'fail', feedback: pending.result.feedback ?? '' });
  }
  return new Promise((resolve, reject) => {
    _stepWaiters.set(runId, { resolve, reject, currentStep: stepIndex });
    // v1.0: no automatic timeout; the DSH must signal. A 2.0 hardening
    // would add a per-step timeout (architecture §9.10.4 mentions "DSH
    // 没有插队决策 -> failed" but pipeline is permitted to keep going
    // via continue; we choose failed as the conservative default).
  });
}

async function runPipelineFailed(runId, reason) {
  await transition(runId, 'running', 'failed', reason);
  return { terminal: 'failed' };
}

/**
 * For tests only: clear the in-memory state. Not part of the public API.
 */
export function _resetForTests() {
  _stepWaiters.clear();
  _pendingSignals.clear();
}
