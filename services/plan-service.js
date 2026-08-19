/**
 * plan-service.js — DSH-only plan generation (Story 1 + §9.9).
 *
 * Per architecture.md §4.6:
 *   - DSH is the only producer (produced_by='scheduler')
 *   - One plan = team-runs/<run-id>/plans/<plan-id>.json + .meta.json
 *   - derived_from is required (selectable from decision / conclusion msg /
 *     user-intervention-log action=complete); no new audit entry
 *   - intent enum: OQ-1 tentative default =
 *     produce | review | collect | synthesize | decide
 *
 * v1.0 scope: write JSON plan + meta.json, get / list. Soft-reference via
 * dispatch.context_refs (no hard cross-plan coupling) is the caller's
 * responsibility; we don't enforce that here.
 *
 * @module dsh-team-plugin/plan-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runDir } from './paths.js';
import { writeJsonFile } from './log-writer.js';

/** @typedef {{
 *   role: string,
 *   intent: 'produce'|'review'|'collect'|'synthesize'|'decide',
 *   expected_artifact: { type: string, desc: string },
 * }} PlanStep
 */

/** @typedef {{
 *   id: string,
 *   run_id: string,
 *   body: string,
 *   steps: PlanStep[],
 *   derived_from: string[],
 *   created_at: string,
 *   produced_by: 'scheduler',
 *   produced_in_session: null,
 * }} Plan
 */

const VALID_INTENTS = new Set(['produce', 'review', 'collect', 'synthesize', 'decide']);

let _seq = 0;
/** @returns {string} */
function newPlanId(runId) {
  _seq += 1;
  return `plan-${runId}-${Date.now().toString(36)}-${_seq.toString(36)}`;
}

function plansDir(runId) {
  return join(runDir(runId), 'plans');
}

/**
 * Generate a plan. v1.0 validates the shape and writes both .json (body +
 * steps + derived_from) and .meta.json (audit). Returns the new plan.
 * @param {{
 *   runId: string,
 *   derivedFrom: string[],
 *   body: string,
 *   steps: PlanStep[],
 * }} req
 * @returns {Promise<Plan>}
 */
export async function generate(req) {
  if (!req?.runId) throw new Error('plan-service.generate: runId is required');
  if (!Array.isArray(req.derivedFrom) || req.derivedFrom.length === 0) {
    throw new Error('plan-service.generate: derivedFrom is required (no new audit entry; OQ-derived)');
  }
  if (typeof req.body !== 'string') {
    throw new Error('plan-service.generate: body must be a string');
  }
  if (!Array.isArray(req.steps) || req.steps.length === 0) {
    throw new Error('plan-service.generate: steps must be a non-empty array');
  }
  for (const s of req.steps) {
    if (typeof s.role !== 'string') throw new Error('plan-service.generate: each step needs a role');
    if (!VALID_INTENTS.has(s.intent)) {
      throw new Error(`plan-service.generate: invalid intent "${s.intent}" (must be one of ${[...VALID_INTENTS].join(', ')})`);
    }
    if (!s.expected_artifact || typeof s.expected_artifact.type !== 'string') {
      throw new Error('plan-service.generate: each step needs expected_artifact.type');
    }
  }
  const id = newPlanId(req.runId);
  const plan = {
    id,
    run_id: req.runId,
    body: req.body,
    steps: req.steps,
    derived_from: req.derivedFrom,
    created_at: new Date().toISOString(),
    produced_by: 'scheduler',
    produced_in_session: null,
  };
  const dir = plansDir(req.runId);
  await writeJsonFile(join(dir, `${id}.json`), plan);
  await writeJsonFile(join(dir, `${id}.meta.json`), {
    id,
    run_id: req.runId,
    produced_by: 'scheduler',
    produced_in_session: null,
    created_at: plan.created_at,
    derived_from: req.derivedFrom,
  });
  return plan;
}

/**
 * Read a plan by id (searches all known run dirs). Returns undefined if
 * not found.
 * @param {string} planId
 * @returns {Promise<Plan | undefined>}
 */
export async function get(planId) {
  if (!planId || !/^plan-/.test(planId)) return undefined;
  // v1.0: planId embeds the runId; we can extract it
  const m = planId.match(/^plan-(run-[^-]+(?:-[^-]+)?)-/);
  if (!m) return undefined;
  const runId = m[1];
  const path = join(plansDir(runId), `${planId}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {Plan} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}

/**
 * List all plans for a run.
 * @param {string} runId
 * @returns {Promise<Plan[]>}
 */
export async function list(runId) {
  const dir = plansDir(runId);
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'));
  const out = [];
  for (const f of entries) {
    try {
      const txt = await readFile(join(dir, f), 'utf-8');
      out.push(/** @type {Plan} */ (JSON.parse(txt)));
    } catch { /* skip unreadable */ }
  }
  return out.sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

/**
 * For tests only.
 */
export function _resetForTests() {
  _seq = 0;
}
