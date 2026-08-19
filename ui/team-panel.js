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

import { createElement as h } from './_react.js';
import { TeamMemberChip } from './team-member-chip.js';
import { TeamDecisionBadge } from './team-decision-badge.js';
import { TeamHandoffCard } from './team-handoff-card.js';
import { TeamHandoffRedo } from './team-handoff-redo.js';

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
export function TeamPanel(props) {
  const { runMeta, waitingCount = 0, waitingKinds = [], recentHandoffs = [] } = props;
  if (!runMeta) {
    return h(
      'div',
      { className: 'dsh-team-panel-empty', style: { padding: 16, color: '#6b7280' } },
      'No active Team Run. Use /start-team to begin.',
    );
  }
  return h(
    'div',
    {
      className: 'dsh-team-panel',
      'data-run-id': runMeta.id,
      'data-state': runMeta.state,
      style: { padding: 12, fontSize: 13, color: '#111827' },
    },
    h('div', { className: 'dsh-team-header', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
      h('strong', { style: { fontSize: 15 } }, `Team Run ${runMeta.id}`),
      h('span', { 'data-flow': runMeta.flow, style: { color: '#6b7280' } }, runMeta.flow),
      h('span', {
        'data-state-pill': runMeta.state,
        style: {
          padding: '1px 8px',
          borderRadius: 10,
          background: stateColor(runMeta.state),
          color: 'white',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
        },
      }, runMeta.state),
      runMeta.degraded_flag
        ? h('span', { 'data-degraded': true, style: { color: '#f59e0b', fontSize: 11 } }, '⚠ degraded')
        : null,
      h(TeamDecisionBadge, { waitingCount, kinds: waitingKinds, runId: runMeta.id }),
    ),
    h('div', { className: 'dsh-team-member-bar', style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 } },
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
    h('div', { className: 'dsh-team-timeline', style: { borderTop: '1px solid #e5e7eb', paddingTop: 8 } },
      ...(recentHandoffs ?? []).map((ho) =>
        ho.state === 'redo'
          ? h(TeamHandoffRedo, { key: ho.id, ...ho })
          : h(TeamHandoffCard, { key: ho.id, ...ho }),
      ),
    ),
  );
}

function stateColor(state) {
  return {
    pending: '#9ca3af',
    assembling: '#3b82f6',
    running: '#22c55e',
    succeeded: '#10b981',
    failed: '#ef4444',
    interrupted: '#f97316',
    aborted: '#6b7280',
    archived: '#4b5563',
  }[state] ?? '#6b7280';
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
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-config',
      kind: 'keyed',
      component: TeamPanel,
      label: 'DSH Team Config',
    }),
  );
  // settings 入口: DSH 的 settings 页面看到 "Team" 一项
  ctx.effect(() =>
    ctx.slots.register({
      name: 'settings.section',
      kind: 'list',
      component: TeamPanel,
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
