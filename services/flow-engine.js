/**
 * flow-engine.js — strategy dispatcher for the three flows.
 *
 * Per architecture.md §4.7: each flow is a strategy; new flows slot in by
 * adding a case. v1.0 ships only handoff-round-table; pipeline-with-
 * feedback + fan-out-collect are P2/P3 (architecture §12).
 *
 * @module dsh-team-plugin/flow-engine
 */
import { readMeta } from './team-service.js';
import { runRoundTable } from './round-table-flow.js';
import { runPipeline } from './pipeline-flow.js';
import { runFanOut } from './fan-out-flow.js';

/**
 * Run a Team Run under its declared flow. Returns when the run reaches a
 * terminal state (succeeded / failed / aborted / interrupted). Throws on
 * illegal states so the caller (lib/index.js) can surface a clear error.
 *
 * v1.0 simplified: the engine doesn't drive the subagent runtime. It
 * orchestrates state machine transitions and opens decision points at the
 * right moments; the actual "DSH invites member X to speak" dispatch is
 * logged to dispatch-log so the panel can show it.
 *
 * @param {string} runId
 * @param {object} [ctx] - Cordis ctx-like object (event bus). For tests
 *   this can be a no-op stub.
 * @returns {Promise<{ terminal: 'succeeded'|'failed'|'aborted'|'interrupted' }>}
 */
export async function run(runId, ctx = null) {
  const meta = await readMeta(runId);
  if (!meta) throw new Error(`flow-engine: run ${runId} not found`);
  if (meta.state !== 'assembling' && meta.state !== 'running' && meta.state !== 'interrupted') {
    throw new Error(`flow-engine: run ${runId} is in state=${meta.state}, cannot start`);
  }
  switch (meta.flow) {
    case 'handoff-round-table':
      return runRoundTable(runId, meta, ctx);
    case 'pipeline-with-feedback':
      return runPipeline(runId, meta, ctx);
    case 'fan-out-collect':
      return runFanOut(runId, meta, ctx);
    default:
      throw new Error(`flow-engine: unknown flow "${meta.flow}"`);
  }
}
