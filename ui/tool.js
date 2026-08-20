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
 * Register the tool slot.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerToolSlot(ctx) {
  if (!ctx?.slots || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; tool slot registration skipped');
    return;
  }
  ctx.effect(() =>
    ctx.slots.register({
      name: 'client-ui-tool',
      kind: 'keyed',
      component: TeamToolCall,
      label: 'DSH Team Tool Call',
    }),
  );
}
