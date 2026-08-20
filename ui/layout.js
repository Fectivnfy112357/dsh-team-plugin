/**
 * layout.js — 常驻面板 chrome (B2 + B5).
 *
 * Per architecture §7.1 + PROGRESS.md §2.0 B2/B5:
 *   - Top bar: brand "DSH Team" + 活跃 Team 的运行状态 pill
 *   - Footer:  ACP / artifact / dispatch / message 4 计数
 *
 * The component registers to the `client-ui-layout` slot via
 * `registerLayoutSlot(ctx)` below. The slot kind is `list` (a list of
 * surface fragments); the host composes top + bottom by stacking the
 * provided components. The component itself renders both ends, with
 * `kind` distinguishing them at the host level.
 *
 * The data sources are read at render time (props are passed by the
 * host; the component is render-only, no side effects). Counters come
 * from the team-service state; active run is the most recent
 * non-terminal Team Run.
 *
 * @module dsh-team-plugin/ui/layout
 */

import { createElement as h, tokens } from './_react.js';

/** @typedef {'top'|'footer'} LayoutKind */

/**
 * Top bar: brand + active run state pill. Empty state when no
 * active run.
 * @param {{
 *   activeRun?: { id: string, state: string, flow: string, degraded_flag?: boolean } | null,
 * }} props
 */
export function TeamTopBar(props) {
  const active = props?.activeRun ?? null;
  return h(
    'div',
    {
      className: 'dsh-team-topbar',
      'data-layout-kind': 'top',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.md,
        padding: `${tokens.space.md}px ${tokens.space.lg}px`,
        background: tokens.color.surface,
        borderBottom: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.lg,
        color: tokens.color.text,
      },
    },
    h('div', { className: 'dsh-team-brand', style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm } },
      h('span', { 'data-brand-mark': true, style: { width: 8, height: 8, borderRadius: tokens.radius.pill, background: tokens.color.accent } }),
      h('strong', { 'data-brand-name': true, style: { fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.semibold } }, 'DSH Team'),
    ),
    active
      ? h('div', { className: 'dsh-team-topbar-active', style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm, marginLeft: 'auto' } },
          h('span', { 'data-active-run-id': active.id, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, active.id),
          h('span', {
            'data-active-state-pill': active.state,
            style: {
              padding: `1px ${tokens.space.md}px`,
              borderRadius: tokens.radius.pill,
              background: stateColor(active.state),
              color: 'white',
              fontSize: tokens.font.size.xs,
              fontWeight: tokens.font.weight.semibold,
              textTransform: 'uppercase',
            },
          }, active.state),
          active.degraded_flag
            ? h('span', { 'data-degraded-pill': true, style: { color: tokens.color.warning, fontSize: tokens.font.size.xs } }, '⚠')
            : null,
        )
      : h('span', { 'data-topbar-empty': true, style: { marginLeft: 'auto', color: tokens.color.muted, fontSize: tokens.font.size.sm } }, 'No active Team Run'),
  );
}

/**
 * Footer: 4 counters (ACP / artifact / dispatch / message). The host
 * passes live counts; on render, missing counts default to 0.
 * @param {{
 *   counts?: {
 *     acp?: number,        // number of live continuable sessions
 *     artifacts?: number,  // total artifacts across all runs
 *     dispatches?: number, // total dispatch-log rows
 *     messages?: number,   // total a2a-message-log rows
 *   },
 * }} props
 */
export function TeamFooter(props) {
  const c = props?.counts ?? {};
  return h(
    'div',
    {
      className: 'dsh-team-footer',
      'data-layout-kind': 'footer',
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.lg,
        padding: `${tokens.space.sm}px ${tokens.space.lg}px`,
        background: tokens.color.surfaceMuted,
        borderTop: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.xs,
        color: tokens.color.muted,
      },
    },
    counter('acp', c.acp ?? 0, 'ACP sessions'),
    counter('artifacts', c.artifacts ?? 0, 'artifacts'),
    counter('dispatches', c.dispatches ?? 0, 'dispatches'),
    counter('messages', c.messages ?? 0, 'messages'),
  );
}

/**
 * @param {string} name
 * @param {number} value
 * @param {string} label
 */
function counter(name, value, label) {
  return h('span', {
    'data-counter': name,
    'data-value': String(value),
    style: { display: 'inline-flex', alignItems: 'baseline', gap: tokens.space.xs },
  },
    h('strong', { style: { color: tokens.color.text, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold } }, String(value)),
    h('span', null, label),
  );
}

/**
 * @param {string} state
 */
function stateColor(state) {
  return tokens.color.state[/** @type {keyof typeof tokens.color.state} */ (state)]
    ?? tokens.color.muted;
}

/**
 * Register the layout chrome on the real DSH `shell.overlay` slot
 * (kind: list, scope: root). Two additive entries:
 *   - `team-topbar` → `TeamTopBar` (brand + active-run state pill)
 *   - `team-footer` → `TeamFooter` (4 counters: ACP / artifacts /
 *     dispatches / messages)
 *
 * `shell.overlay` is a frame-wide floating layer the DSH web shell
 * reserves for badges, status pills and toasts. Catalog reference:
 * `cordis-client-runner/src/client/slot-catalog.ts:1437` (additive,
 * `replaceRisk: 'none'`).
 *
 * Each entry is wrapped in `ctx.slots.inject(key, ...)` so the
 * registration re-runs if the slot owner remounts (per
 * `client-modules` Cordis notes).
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerLayoutSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin/ui/layout: ctx.slots.inject unavailable; team-topbar / team-footer skipped');
    return;
  }
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      kind: 'list',
      id: 'team-topbar',
      order: 50,
      component: TeamTopBar,
      label: 'DSH Team Top Bar',
    }),
  );
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register({
      name: 'shell.overlay',
      kind: 'list',
      id: 'team-footer',
      order: 50,
      component: TeamFooter,
      label: 'DSH Team Footer',
    }),
  );
}
