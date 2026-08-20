/**
 * team-plan.js — render a Plan artifact on the Team Plugin UI.
 *
 * Per architecture.md §4.6 + §7.3:
 *   - The plan payload is `{ id, run_id, body, steps, derived_from, ... }`
 *     (§9.9 OQ-1 tentative step intents: produce | review | collect |
 *     synthesize | decide).
 *   - Slot id `team-plan`; component receives a resolved `plan` object
 *     from the host (the host wires PlanService.get(planId) on the React
 *     side; the component itself is sync to keep parity with the other
 *     team.* UI files).
 *   - Three states: loading (plan missing) / error / content.
 *
 * The host can call the exported `loadPlan(planId)` helper to resolve
 * the plan from PlanService without needing a separate import path
 * (slot consumers don't have to know about the service module).
 *
 * @module dsh-team-plugin/ui/team-plan
 */

import { createElement as h } from './_react.js';

/**
 * @typedef {{
 *   role: string,
 *   intent: 'produce'|'review'|'collect'|'synthesize'|'decide',
 *   expected_artifact: { type: string, desc: string },
 * }} PlanStep
 */

/**
 * @typedef {{
 *   id: string,
 *   run_id: string,
 *   body: string,
 *   steps: PlanStep[],
 *   derived_from: string[],
 *   created_at: string,
 *   produced_by: string,
 *   produced_in_session: any,
 * }} Plan
 */

const INTENT_COLOR = {
  produce: '#3b82f6',     // blue
  review: '#eab308',      // yellow
  collect: '#a855f7',     // purple
  synthesize: '#22c55e',  // green
  decide: '#f97316',      // orange
};

/**
 * Resolve a plan by id via the PlanService. Returns `undefined` when
 * the service is unavailable or the plan does not exist. Slot hosts
 * (which run inside DSH) call this from their React useEffect path;
 * tests can call it directly against the in-process PlanService.
 *
 * @param {string} planId
 * @returns {Promise<Plan | undefined>}
 */
export async function loadPlan(planId) {
  if (!planId) return undefined;
  try {
    const mod = await import('../services/plan-service.js');
    return await mod.get(planId);
  } catch {
    return undefined;
  }
}

/**
 * @param {{
 *   planId?: string,
 *   plan?: Plan | null,
 *   error?: string,
 * }} props
 */
export function TeamPlan(props) {
  const { planId, plan, error } = props;

  // -- error state --------------------------------------------------------
  if (error) {
    return h(
      'div',
      {
        className: 'dsh-team-plan dsh-team-plan--error',
        'data-plan-id': planId,
        'data-state': 'error',
        style: { padding: 12, color: '#b91c1c', fontSize: 12 },
      },
      `Failed to load plan${planId ? ` ${planId}` : ''}: ${error}`,
    );
  }

  // -- loading state -------------------------------------------------------
  if (!plan) {
    return h(
      'div',
      {
        className: 'dsh-team-plan dsh-team-plan--loading',
        'data-plan-id': planId,
        'data-state': 'loading',
        style: { padding: 12, color: '#6b7280', fontSize: 12, fontStyle: 'italic' },
      },
      planId ? `Loading plan ${planId}\u2026` : 'Loading plan\u2026',
    );
  }

  // -- content state -------------------------------------------------------
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return h(
    'div',
    {
      className: 'dsh-team-plan',
      'data-plan-id': plan.id,
      'data-run-id': plan.run_id,
      'data-state': 'content',
      'data-step-count': String(steps.length),
      style: { padding: 12, fontSize: 13, color: '#111827' },
    },
    h('div', { className: 'dsh-team-plan-header', style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 } },
      h('strong', { style: { fontSize: 14 } }, `Plan ${plan.id}`),
      h('span', { 'data-run-id': true, style: { color: '#6b7280', fontSize: 11 } }, plan.run_id),
      h('span', { 'data-step-count': true, style: { color: '#6b7280', fontSize: 11 } }, `${steps.length} step${steps.length === 1 ? '' : 's'}`),
      h('span', { 'data-produced-by': plan.produced_by, style: { marginLeft: 'auto', color: '#6b7280', fontSize: 11 } }, plan.produced_by),
    ),
    h('div', { className: 'dsh-team-plan-body', 'data-plan-body': true, style: { marginBottom: 10, whiteSpace: 'pre-wrap' } },
      plan.body,
    ),
    h('ol', {
      className: 'dsh-team-plan-steps',
      'data-step-list': true,
      style: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 },
    },
      ...steps.map((s, i) => renderStep(s, i)),
    ),
    Array.isArray(plan.derived_from) && plan.derived_from.length > 0
      ? h('div', {
          className: 'dsh-team-plan-derived',
          'data-derived-from': plan.derived_from.join(','),
          style: { marginTop: 10, fontSize: 11, color: '#6b7280' },
        },
          'derived_from: ',
          ...plan.derived_from.map((ref, i) =>
            h('span', { key: `${i}-${ref}`, 'data-ref': ref, style: { marginRight: 6 } }, ref),
          ),
        )
      : null,
  );
}

function renderStep(step, index) {
  const intent = typeof step?.intent === 'string' ? step.intent : 'unknown';
  const intentColor = INTENT_COLOR[intent] ?? '#6b7280';
  return h(
    'li',
    {
      className: 'dsh-team-plan-step',
      'data-step-index': String(index),
      'data-intent': intent,
      style: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: 8,
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        background: '#fafafa',
      },
    },
    h('span', { 'data-step-num': true, style: { color: '#6b7280', fontSize: 11, minWidth: 18, flex: '0 0 auto' } }, `${index + 1}.`),
    h('span', {
      'data-intent-badge': intent,
      style: {
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 8,
        background: intentColor,
        color: 'white',
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        flex: '0 0 auto',
      },
    }, intent),
    h('div', { style: { flex: '1 1 auto', minWidth: 0 } },
      h('div', { 'data-step-role': true, style: { fontWeight: 500 } }, step?.role ?? '(unknown role)'),
      step?.expected_artifact
        ? h('div', {
            'data-step-expected': true,
            style: { color: '#6b7280', fontSize: 11, marginTop: 2 },
          },
            `${step.expected_artifact.type}: ${step.expected_artifact.desc}`,
          )
        : null,
    ),
  );
}
