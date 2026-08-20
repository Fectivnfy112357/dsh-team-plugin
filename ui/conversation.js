/**
 * conversation.js — 主区 timeline (B8).
 *
 * Per architecture §7.2 + PROGRESS.md §2.0 B8:
 *   - Renders the conversation timeline for a Team Run, including
 *     A2A messages, handoff cards, and decision points. The host
 *     resolves the message log + handoff log + DP state from the
 *     services and passes it as a flat list; this component sorts
 *     by timestamp and renders each entry as the appropriate kind.
 *   - Density adapts to the flow type:
 *       - round-table: A2A messages dominate; handoff cards are short
 *       - pipeline:    A2A is sparse; handoff cards lead (step transitions)
 *       - fan-out:     A2A parallel branches visible; aggregator at end
 *   - in_reply_to relationships are drawn as a faint dotted connector
 *     to the parent message (data-in-reply-to attribute for the host
 *     to style).
 *
 * The component is render-only; the host wires click handlers + scroll.
 *
 * @module dsh-team-plugin/ui/conversation
 */

import { createElement as h, tokens } from './_react.js';
import { TeamHandoffCard } from './team-handoff-card.js';
import { TeamHandoffRedo } from './team-handoff-redo.js';

/** @typedef {{
 *   id: string,
 *   kind: 'a2a-message'|'handoff'|'handoff-redo'|'decision',
 *   timestamp: string,
 *   from?: string,
 *   to?: string,
 *   topic?: string,
 *   intent?: string,
 *   text?: string,
 *   inReplyTo?: string,
 *   payload?: any,
 * }} ConversationEntry
 */

/** @typedef {{
 *   entries?: ConversationEntry[],
 *   flow?: 'handoff-round-table'|'pipeline-with-feedback'|'fan-out-collect',
 *   emptyMessage?: string,
 * }} Props
 */

const DENSITY = {
  'handoff-round-table': { a2a: 0.7, handoff: 0.3 },
  'pipeline-with-feedback': { a2a: 0.3, handoff: 0.7 },
  'fan-out-collect': { a2a: 0.6, handoff: 0.4 },
};

/**
 * @param {ConversationEntry} e
 */
function renderEntry(e) {
  if (e.kind === 'handoff' || e.kind === 'handoff-redo') {
    const Card = e.kind === 'handoff-redo' ? TeamHandoffRedo : TeamHandoffCard;
    return h(Card, { key: e.id, ...e });
  }
  if (e.kind === 'a2a-message') {
    return h(
      'div',
      {
        key: e.id,
        className: 'dsh-conversation-a2a',
        'data-entry-id': e.id,
        'data-in-reply-to': e.inReplyTo ?? '',
        'data-from': e.from,
        'data-to': e.to,
        'data-intent': e.intent,
        style: {
          padding: `${tokens.space.sm}px ${tokens.space.md}px`,
          margin: `${tokens.space.xs}px 0`,
          background: tokens.color.surfaceAlt,
          borderLeft: `3px solid ${intentColor(e.intent)}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.font.size.md,
          color: tokens.color.text,
          fontFamily: tokens.font.family,
        },
      },
      h('div', { className: 'dsh-conversation-a2a-header', style: { fontSize: tokens.font.size.xs, color: tokens.color.muted, marginBottom: tokens.space.xs } },
        e.from && e.to ? `${e.from} → ${e.to}` : (e.from ?? ''),
        e.topic ? ` · ${e.topic}` : '',
        e.intent ? ` · ${e.intent}` : '',
      ),
      h('div', { className: 'dsh-conversation-a2a-body', 'data-a2a-text': e.text ?? '', style: { whiteSpace: 'pre-wrap' } },
        e.text ?? '',
      ),
    );
  }
  if (e.kind === 'decision') {
    return h(
      'div',
      {
        key: e.id,
        className: 'dsh-conversation-decision',
        'data-entry-id': e.id,
        'data-decision-id': e.id,
        style: {
          padding: tokens.space.md,
          margin: `${tokens.space.xs}px 0`,
          background: tokens.color.warningSoft,
          borderLeft: `3px solid ${tokens.color.warning}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.font.size.md,
          fontFamily: tokens.font.family,
        },
      },
      h('div', { style: { fontWeight: tokens.font.weight.semibold, fontSize: tokens.font.size.sm, color: tokens.color.warning } }, '决策点'),
      h('div', { style: { marginTop: tokens.space.xs } }, e.text ?? ''),
    );
  }
  return null;
}

/** @param {string | undefined} intent */
function intentColor(intent) {
  if (!intent) return tokens.color.muted;
  return tokens.color.intent[/** @type {keyof typeof tokens.color.intent} */ (intent)]
    ?? tokens.color.muted;
}

/**
 * @param {Props} props
 */
export function ConversationTimeline(props) {
  const entries = Array.isArray(props?.entries) ? props.entries.slice() : [];
  const flow = props?.flow ?? 'handoff-round-table';
  const density = DENSITY[flow] ?? DENSITY['handoff-round-table'];
  entries.sort((a, b) => (a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0));
  return h(
    'div',
    {
      className: 'dsh-conversation-timeline',
      'data-flow': flow,
      'data-density-a2a': density.a2a,
      'data-density-handoff': density.handoff,
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.xs,
        padding: tokens.space.md,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
      },
    },
    entries.length === 0
      ? h('div', { className: 'dsh-conversation-empty', 'data-empty': true, style: { padding: tokens.space.lg, color: tokens.color.muted, fontSize: tokens.font.size.md, fontStyle: 'italic' } },
        props?.emptyMessage ?? 'No messages yet.')
      : entries.map(renderEntry),
  );
}

/**
 * Register the conversation slot.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerConversationSlot(ctx) {
  if (!ctx?.slots || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; conversation slot registration skipped');
    return;
  }
  ctx.effect(() =>
    ctx.slots.register({
      name: 'client-ui-conversation',
      kind: 'list',
      component: ConversationTimeline,
      label: 'DSH Team Conversation',
    }),
  );
}
