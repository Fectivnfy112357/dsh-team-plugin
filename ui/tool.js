/**
 * tool.js — 工具调用呈现 (B10).
 *
 * Per PROGRESS.md §2.0 B10: 工具调用呈现 (dispatch / handoff 卡片)
 * plus a generic tool call framework. The existing
 * `team-handoff-card.js` + `team-handoff-redo.js` are reused for
 * dispatch / handoff; this file adds a generic `TeamToolCall` wrapper
 * for non-team tool invocations (so the chrome has a single shape for
 * "user invoked a tool" entries).
 *
 * The host renders the component on the `client-ui-tool` slot.
 *
 * @module dsh-team-plugin/ui/tool
 */

import { createElement as h, tokens } from './_react.js';
import { TeamHandoffCard } from './team-handoff-card.js';
import { TeamHandoffRedo } from './team-handoff-redo.js';

/**
 * @param {{
 *   toolName: string,
 *   args?: any,
 *   result?: any,
 *   status?: 'pending'|'complete'|'failed',
 *   variant?: 'default'|'dispatch'|'handoff'|'handoff-redo',
 *   startedAt?: string,
 *   endedAt?: string,
 * }} props
 */
export function TeamToolCall(props) {
  const { toolName, args, result, status = 'complete', variant = 'default' } = props;
  // Dispatch / handoff variants are delegated to the dedicated cards
  // for visual consistency with the existing chat timeline.
  if (variant === 'dispatch' || variant === 'handoff') {
    return h(TeamHandoffCard, {
      id: toolName,
      from: args?.from,
      to: args?.to,
      task: args?.task,
      artifacts: args?.context_refs,
      reason: args?.reason,
      ...(result ?? {}),
    });
  }
  if (variant === 'handoff-redo') {
    return h(TeamHandoffRedo, {
      id: toolName,
      from: args?.from,
      to: args?.to,
      task: args?.task,
      reason: args?.reason,
      ...(result ?? {}),
    });
  }
  // Generic shape for other tool calls.
  return h(
    'div',
    {
      className: 'dsh-team-tool-call',
      'data-tool-name': toolName,
      'data-status': status,
      'data-variant': variant,
      style: {
        padding: tokens.space.md,
        margin: `${tokens.space.xs}px 0`,
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderLeft: `3px solid ${statusColor(status)}`,
        borderRadius: tokens.radius.md,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
      },
    },
    h('div', { className: 'dsh-team-tool-call-header', style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm, marginBottom: tokens.space.xs } },
      h('span', { 'data-tool-name-pill': true, style: { padding: `1px ${tokens.space.sm}px`, borderRadius: tokens.radius.sm, background: tokens.color.surfaceMuted, color: tokens.color.text, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } },
        toolName,
      ),
      h('span', { 'data-tool-status': status, style: { color: statusColor(status), fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } },
        status,
      ),
    ),
    args ? h('details', { 'data-tool-args': true, style: { fontSize: tokens.font.size.sm } },
      h('summary', { style: { cursor: 'pointer', color: tokens.color.muted } }, 'args'),
      h('pre', { style: { margin: `${tokens.space.xs}px 0 0 0`, padding: tokens.space.sm, background: tokens.color.surfaceMuted, borderRadius: tokens.radius.sm, overflow: 'auto', fontSize: tokens.font.size.xs } },
        JSON.stringify(args, null, 2),
      ),
    ) : null,
    result ? h('details', { 'data-tool-result': true, open: true, style: { fontSize: tokens.font.size.sm, marginTop: tokens.space.xs } },
      h('summary', { style: { cursor: 'pointer', color: tokens.color.muted } }, 'result'),
      h('pre', { style: { margin: `${tokens.space.xs}px 0 0 0`, padding: tokens.space.sm, background: tokens.color.surfaceMuted, borderRadius: tokens.radius.sm, overflow: 'auto', fontSize: tokens.font.size.xs } },
        JSON.stringify(result, null, 2),
      ),
    ) : null,
  );
}

/** @param {string} status */
function statusColor(status) {
  if (status === 'complete') return tokens.color.success;
  if (status === 'failed') return tokens.color.danger;
  return tokens.color.warning;
}

/**
 * Every `team.*` tool name registered by `lib/tools/team-tools.js`.
 * Each becomes a separate `key` on the `tool.call.toolview` slot so
 * the wire dispatch lands on the Team-specific card instead of the
 * generic fallback. The set is the source of truth — if a new
 * `team.*` tool lands, add it here too.
 *
 * @type {readonly string[]}
 */
const TEAM_TOOL_NAMES = Object.freeze([
  // 1.0 lifecycle (8)
  'team.start',
  'team.list',
  'team.abort',
  'team.list_runs',
  'team.rerun',
  'team.resume',
  'team.check_cost_cap',
  'team.list_adapters',
  // 1.5 decision points (3)
  'team.open_decision_point',
  'team.respond_decision_point',
  'team.list_decision_points',
  // 1.5 step / branch signals (4)
  'team.complete_step',
  'team.fail_step',
  'team.complete_branch',
  'team.fail_branch',
  // 1.5 plan (2)
  'team.add_plan',
  'team.list_plans',
  // 1.5 artifact (3)
  'team.register_artifact',
  'team.list_artifacts',
  'team.delete_artifact',
  // 2.0 CRUD role / member / template (9)
  'team.create_role',
  'team.update_role',
  'team.delete_role',
  'team.create_member',
  'team.update_member',
  'team.delete_member',
  'team.create_template',
  'team.update_template',
  'team.delete_template',
]);

/**
 * Register the tool call views on the real DSH `tool.call.toolview`
 * slot (kind: keyed, scope: session, dispatch by wire tool name).
 * Catalog reference:
 * `cordis-client-runner/src/client/slot-catalog.ts:1628` (`replaceRisk:
 * 'none'`, key domain open: any string the owner dispatches). All
 * `team.*` keys are free (none in the shipped key set, see catalog
 * line 1656), so this is purely additive.
 *
 * The previous version used a single registration with no `key` field
 * — that lands on the generic fallback, not the keyed dispatch, so
 * every team tool call would still render with the shipped tool card.
 * One register call per `key` is the contract the catalog documents.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerToolSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin/ui/tool: ctx.slots.inject unavailable; team.* tool views skipped');
    return;
  }
  for (const toolName of TEAM_TOOL_NAMES) {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({
        name: 'tool.call.toolview',
        kind: 'keyed',
        key: toolName,
        component: TeamToolCall,
        label: `DSH Team Tool: ${toolName}`,
      }),
    );
  }
}
