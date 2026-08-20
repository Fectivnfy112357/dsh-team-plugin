/**
 * team-panel.js — slot registration for the Team Plugin UI.
 *
 * Per architecture.md §7.1: this plugin introduces two new slots
 *   - `team-panel`  (list)  — the常驻面板 root component
 *   - `team-config` (keyed) — the Team / Role / Member configuration centre
 * and registers UI components on the existing `tool.call.toolview` /
 * `conversation.chat.node` slots so handoff cards + decision badges
 * appear in the main timeline.
 *
 * v1.0 components (5):
 *   - TeamPanel         (this file) — 常驻面板 root;renders member bar + timeline
 *   - TeamMemberChip    (team-member-chip.js)
 *   - TeamDecisionBadge (team-decision-badge.js)
 *   - TeamHandoffCard   (team-handoff-card.js)
 *   - TeamHandoffRedo   (team-handoff-redo.js)
 *
 * v1.0 doesn't subscribe to live Cordis events from the components; the
 * panel reads `props.runMeta` (passed by the DSH host) and renders a
 * snapshot. Live subscription lands in P1.5 via the on() helper that
 * already exists in DecisionPointService.
 *
 * @module dsh-team-plugin/team-panel
 */

import { createElement as h, tokens } from './_react.js';
import { TeamMemberChip } from './team-member-chip.js';
import { TeamDecisionBadge } from './team-decision-badge.js';
import { TeamHandoffCard } from './team-handoff-card.js';
import { TeamHandoffRedo } from './team-handoff-redo.js';
import { TeamPlan, loadPlan } from './team-plan.js';
import { TeamConfigPanel } from './team-config.js';

// Re-export the plan component + loader so host slots and tests can
// reach them without re-importing './team-plan.js' (the panel is the
// single import surface for the lib/index.js slot registration path).
export { TeamPlan, loadPlan, TeamConfigPanel };

/**
 * Subscribe to live decision-point changes emitted on the ctx event
 * bus. The host's React tree calls this from a useEffect to keep the
 * `team-decision-badge` in sync with the registry — see PROGRESS.md
 * P1.5-b. The plugin side wires DecisionPointService -> ctx events in
 * `lib/index.js` so this helper just forwards.
 *
 * @param {{
 *   on?: (event: string, handler: (dp: any) => void) => () => void,
 * }} ctx
 * @param {(change: { runId: string, kind: string, action: 'open'|'respond', dp: any }) => void} onChange
 * @returns {() => void} disposer
 */
export function subscribeDps(ctx, onChange) {
  if (!ctx || typeof ctx.on !== 'function') return () => {};
  const off1 = ctx.on('team/decision-point-open', (dp) => {
    try { onChange?.({ runId: dp.runId, kind: dp.kind, action: 'open', dp }); } catch { /* listener errors must not break the panel */ }
  });
  const off2 = ctx.on('team/decision-point-respond', (dp) => {
    try { onChange?.({ runId: dp.runId, kind: dp.kind, action: 'respond', dp }); } catch { /* listener errors must not break the panel */ }
  });
  return () => {
    try { off1?.(); } catch { /* disposer errors must not break the panel */ }
    try { off2?.(); } catch { /* disposer errors must not break the panel */ }
  };
}

/**
 * Root panel. Renders the team header (name + flow + status), the member
 * bar, the decision badge (if any), and the timeline stub.
 *
 * @param {{
 *   runMeta?: { id: string, state: string, degraded_flag: boolean, flow: string, members: Array<any> },
 *   waitingCount?: number,
 *   waitingKinds?: string[],
 *   recentHandoffs?: Array<any>,
 * }} props
 */
/**
 * B4 main header: Team name + flow type + 团队操作按钮 (rerun / abort /
 * ad-hoc DP insert). The host wires the onRerun / onAbort / onInsertAdHoc
 * callbacks; the buttons are pure render. The "ad-hoc" button is only
 * shown when the run is `running` and `flow_config.ad_hoc_decision_points`
 * is true (per requirements §9.10.1).
 *
 * @param {{
 *   runMeta: { id: string, state: string, flow: string, degraded_flag?: boolean, flow_config?: { ad_hoc_decision_points?: boolean } },
 *   onRerun?: (runId: string) => void,
 *   onAbort?: (runId: string) => void,
 *   onInsertAdHoc?: (runId: string) => void,
 *   onResume?: (runId: string) => void,
 * }} props
 */
function MainHeader(props) {
  const { runMeta, onRerun, onAbort, onInsertAdHoc, onResume } = props;
  const isRunning = runMeta.state === 'running' || runMeta.state === 'assembling';
  const isInterrupted = runMeta.state === 'interrupted';
  const isTerminal = ['succeeded', 'failed', 'aborted', 'archived'].includes(runMeta.state);
  const adHocEnabled = runMeta.flow_config?.ad_hoc_decision_points === true;
  return h(
    'div',
    { className: 'dsh-team-main-header', 'data-run-id': runMeta.id, style: { display: 'flex', alignItems: 'center', gap: tokens.space.md, padding: tokens.space.md, borderBottom: `1px solid ${tokens.color.border}`, background: tokens.color.surface, fontFamily: tokens.font.family } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm, flex: '1 1 auto', minWidth: 0 } },
      h('strong', { 'data-main-header-team-id': runMeta.id, style: { fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.semibold, color: tokens.color.text, fontFamily: 'monospace' } }, runMeta.id),
      h('span', { 'data-main-header-flow': runMeta.flow, style: { padding: `1px ${tokens.space.sm}px`, borderRadius: tokens.radius.pill, background: tokens.color.accentSoft, color: tokens.color.accent, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } },
        runMeta.flow,
      ),
      h('span', {
        'data-main-header-state-pill': runMeta.state,
        style: {
          padding: `1px ${tokens.space.md}px`,
          borderRadius: tokens.radius.pill,
          background: stateColor(runMeta.state),
          color: 'white',
          fontSize: tokens.font.size.xs,
          fontWeight: tokens.font.weight.semibold,
          textTransform: 'uppercase',
        },
      }, runMeta.state),
    ),
    h('div', { className: 'dsh-team-main-header-actions', 'data-main-header-actions': true, style: { display: 'flex', gap: tokens.space.sm } },
      isRunning && onInsertAdHoc && adHocEnabled
        ? h('button', {
            type: 'button',
            'data-action': 'insert-adhoc',
            onClick: () => onInsertAdHoc(runMeta.id),
            style: actionButtonStyle('secondary'),
          }, '+ 决策点')
        : null,
      isInterrupted && onResume
        ? h('button', {
            type: 'button',
            'data-action': 'resume',
            onClick: () => onResume(runMeta.id),
            style: actionButtonStyle('primary'),
          }, 'Resume')
        : null,
      isTerminal && onRerun
        ? h('button', {
            type: 'button',
            'data-action': 'rerun',
            onClick: () => onRerun(runMeta.id),
            style: actionButtonStyle('primary'),
          }, 'Rerun')
        : null,
      isRunning && onAbort
        ? h('button', {
            type: 'button',
            'data-action': 'abort',
            onClick: () => onAbort(runMeta.id),
            style: actionButtonStyle('danger'),
          }, 'Abort')
        : null,
    ),
  );
}

/** @param {'primary'|'secondary'|'danger'} kind */
function actionButtonStyle(kind) {
  const palette = {
    primary: { bg: tokens.color.accent, fg: 'white' },
    secondary: { bg: tokens.color.surface, fg: tokens.color.text, border: tokens.color.border },
    danger: { bg: tokens.color.danger, fg: 'white' },
  }[kind];
  return {
    padding: `${tokens.space.sm}px ${tokens.space.md}px`,
    fontSize: tokens.font.size.sm,
    fontWeight: tokens.font.weight.semibold,
    background: palette.bg,
    color: palette.fg,
    border: palette.border ? `1px solid ${palette.border}` : 'none',
    borderRadius: tokens.radius.md,
    cursor: 'pointer',
  };
}

export function TeamPanel(props) {
  const { runMeta, waitingCount = 0, waitingKinds = [], recentHandoffs = [] } = props;
  if (!runMeta) {
    return h(
      'div',
      { className: 'dsh-team-panel-empty', style: { padding: tokens.space.xl, color: tokens.color.muted } },
      'No active Team Run. Use /start-team to begin.',
    );
  }
  return h(
    'div',
    {
      className: 'dsh-team-panel',
      'data-run-id': runMeta.id,
      'data-state': runMeta.state,
      style: { padding: 0, fontSize: tokens.font.size.lg, color: tokens.color.text, fontFamily: tokens.font.family },
    },
    h(MainHeader, {
      runMeta,
      onRerun: props?.onRerun,
      onAbort: props?.onAbort,
      onInsertAdHoc: props?.onInsertAdHoc,
      onResume: props?.onResume,
    }),
    h('div', { className: 'dsh-team-panel-body', style: { padding: tokens.space.lg } },
      h('div', { className: 'dsh-team-header', style: { display: 'flex', alignItems: 'center', gap: tokens.space.md, marginBottom: tokens.space.lg } },
        h('strong', { style: { fontSize: tokens.font.size.xxl } }, `Team Run ${runMeta.id}`),
        h(TeamDecisionBadge, { waitingCount, kinds: waitingKinds, runId: runMeta.id }),
      ),
      h('div', { className: 'dsh-team-member-bar', style: { display: 'flex', flexWrap: 'wrap', gap: tokens.space.sm, marginBottom: tokens.space.lg } },
        ...(runMeta.members ?? []).map((m) =>
          h(TeamMemberChip, {
            key: m.member_id,
            memberId: m.member_id,
            displayName: m.instance_alias ?? m.member_id,
            roleId: m.member_id,
            adapter: m.adapter ?? 'hermes',
            state: 'idle',
          }),
        ),
      ),
      h('div', { className: 'dsh-team-timeline', style: { borderTop: `1px solid ${tokens.color.border}`, paddingTop: tokens.space.md } },
        ...(recentHandoffs ?? []).map((ho) =>
          ho.state === 'redo'
            ? h(TeamHandoffRedo, { key: ho.id, ...ho })
            : h(TeamHandoffCard, { key: ho.id, ...ho }),
        ),
      ),
    ),
  );
}

function stateColor(state) {
  // Sourced from the B1 token system so the colour stays consistent
  // with the rest of the chrome. Tokens are the single source of truth
  // for the Team Run state pill background.
  return tokens.color.state[/** @type {keyof typeof tokens.color.state} */ (state)]
    ?? tokens.color.muted;
}

/**
 * Register the team slots and the keyed component slot for handoff cards.
 * Effect-wrapped; the disposer from `ctx.slots.register(...)` runs when
 * the Cordis plugin unloads.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerTeamSlots(ctx) {
  if (!ctx.slots || typeof ctx.slots.register !== 'function') {
    ctx.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; slot registration skipped');
    return;
  }
  // team-panel slot (list): the常驻面板 root
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-panel',
      kind: 'list',
      component: TeamPanel,
      label: 'DSH Team',
    }),
  );
  // team-config slot (keyed): Team / Role / Member / Team-Template edit
  // A5 (2.0): the previous binding was `TeamPanel` (a run-state
  // component) — wrong, the config surface is independent. The
  // TeamConfigPanel (Role / Member / TeamTemplate 3 tabs) is the
  // correct component; the host wires props.roles / .members /
  // .templates via the three services in its React useEffect.
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-config',
      kind: 'keyed',
      component: TeamConfigPanel,
      label: 'DSH Team Config',
    }),
  );
  // team-plan slot (keyed): render a single Plan artifact. Hosts
  // resolve the plan via `loadPlan(planId)` and pass the resolved
  // object as `props.plan`; the slot only carries the component.
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-plan',
      kind: 'keyed',
      component: TeamPlan,
      label: 'DSH Team Plan',
    }),
  );
  // settings 入口: DSH 的 settings 页面看到 "Team" 一项
  // A5 (2.0): the previous binding was `TeamPanel` (a run-state
  // component) — wrong. The settings page is a "configure plugin"
  // surface, which is what TeamConfigPanel renders.
  ctx.effect(() =>
    ctx.slots.register({
      name: 'settings.section',
      kind: 'list',
      component: TeamConfigPanel,
      label: 'Team',
      props: { sectionId: 'dsh-team', title: 'DSH Team Plugin' },
    }),
  );
  // handoff / decision badge / member chip —— 通过 keyed 工具 view
  // 暴露,让 tool.call.toolview <team-handoff>/<team-decision>/<team-member>
  // 能找到组件。
  ctx.effect(() =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      kind: 'keyed',
      component: TeamHandoffCard,
      entryKey: 'team-handoff',
      label: 'Team Handoff Card',
    }),
  );
  ctx.effect(() =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      kind: 'keyed',
      component: TeamHandoffRedo,
      entryKey: 'team-handoff-redo',
      label: 'Team Handoff Redo Card',
    }),
  );
  ctx.effect(() =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      kind: 'keyed',
      component: TeamMemberChip,
      entryKey: 'team-member-chip',
      label: 'Team Member Chip',
    }),
  );
  ctx.effect(() =>
    ctx.slots.register({
      name: 'tool.call.toolview',
      kind: 'keyed',
      component: TeamDecisionBadge,
      entryKey: 'team-decision-badge',
      label: 'Team Decision Badge',
    }),
  );
}
