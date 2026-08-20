/**
 * plan.js — plan 通用呈现 (B11).
 *
 * Per PROGRESS.md §2.0 B11: 通用 plan 呈现 (与 `team-plan` 协同).
 *
 * `team-plan` (P1.5-a) renders a single Plan from PlanService — keyed,
 * host-resolved via `loadPlan(planId)`. `client-ui-plan` is a slot
 * for the DSH host's **generic** plan surface (the host's default
 * plan UI, when no per-plugin component is registered). This file
 * provides a DSH Team Plugin fallback that re-uses the TeamPlan
 * component but also accepts a "DSH Team plan" wrapper so the host
 * can mount it on the `client-ui-plan` slot.
 *
 * The DSH host picks the most specific component for any given plan
 * (the `team-plan` keyed slot wins for Team-Plan-typed plans; the
 * `client-ui-plan` slot is the fallback).
 *
 * @module dsh-team-plugin/ui/plan
 */

import { createElement as h, tokens } from './_react.js';
import { TeamPlan, loadPlan } from './team-plan.js';

/**
 * Plan fallback for the `client-ui-plan` slot. Renders a header pill
 * + the existing `TeamPlan` body. When the plan payload is missing,
 * renders a "loading" state.
 *
 * @param {{
 *   planId?: string,
 *   plan?: any,
 *   error?: string,
 * }} props
 */
export function PlanSurface(props) {
  const { planId, plan, error } = props;
  if (error) {
    return h(
      'div',
      { className: 'dsh-plan-surface dsh-plan-surface--error', 'data-state': 'error', style: { padding: tokens.space.lg, color: tokens.color.danger, fontSize: tokens.font.size.md } },
      `Failed to load plan${planId ? ` ${planId}` : ''}: ${error}`,
    );
  }
  return h(
    'div',
    {
      className: 'dsh-plan-surface',
      'data-component': 'plan-surface',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.md,
        padding: tokens.space.lg,
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        fontFamily: tokens.font.family,
      },
    },
    h('div', { className: 'dsh-plan-surface-header', style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm, fontSize: tokens.font.size.sm, color: tokens.color.muted } },
      h('span', { 'data-plan-surface-pill': true, style: { padding: `1px ${tokens.space.sm}px`, borderRadius: tokens.radius.pill, background: tokens.color.accentSoft, color: tokens.color.accent, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold, textTransform: 'uppercase' } },
        'DSH Team Plan',
      ),
      planId ? h('span', { 'data-plan-surface-id': true, style: { fontFamily: 'monospace' } }, planId) : null,
    ),
    h(TeamPlan, { planId, plan }),
  );
}

/**
 * Resolve a plan by id via PlanService.get. Re-exported for symmetry
 * with the `team-plan` slot (slot consumers don't have to know about
 * the service module).
 * @param {string} planId
 * @returns {Promise<any>}
 */
export { loadPlan };

/**
 * Register the plan slot (fallback).
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerPlanSlot(ctx) {
  if (!ctx?.slots || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; plan slot registration skipped');
    return;
  }
  ctx.effect(() =>
    ctx.slots.register({
      name: 'client-ui-plan',
      kind: 'keyed',
      component: PlanSurface,
      label: 'DSH Team Plan (fallback)',
    }),
  );
}
