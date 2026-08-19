/**
 * team-handoff-card.js — main-area card representing a handoff event.
 *
 * Per architecture.md §7.3: dispatch / handoff events render as
 * independent cards in the timeline (not as chat bubbles). The card
 * shows from → to, the task text, the context refs, and the produced
 * artifacts (if terminal).
 *
 * Two variants share the same base component:
 *   - team-handoff-card (default): normal handoff
 *   - team-handoff-redo: red-themed variant for the "需修改清单" / 退回
 *     case (architecture §7.3 handoff 退回 row + Story 2 feedback loop)
 *
 * @module dsh-team-plugin/ui/team-handoff-card
 */

import { createElement as h } from './_react.js';

/**
 * @param {{
 *   from: string,
 *   to: string,
 *   task?: string,
 *   contextRefs?: string[],
 *   artifacts?: string[],
 *   reason?: string,
 *   state?: 'in_flight'|'completed'|'failed'|'interrupted'|'redo',
 *   variant?: 'normal'|'redo',
 * }} props
 */
export function TeamHandoffCard(props) {
  const {
    from,
    to,
    task = '',
    contextRefs = [],
    artifacts = [],
    reason,
    state = 'in_flight',
    variant = 'normal',
  } = props;
  const isRedo = variant === 'redo' || state === 'redo';
  const accent = isRedo ? '#ef4444' : '#3b82f6';
  return h(
    'div',
    {
      className: 'dsh-team-handoff-card',
      'data-variant': variant,
      'data-state': state,
      style: {
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 6,
        padding: '10px 12px',
        margin: '8px 0',
        background: isRedo ? '#fef2f2' : '#eff6ff',
        fontSize: 13,
        color: '#111827',
      },
    },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } },
      h('span', { style: { fontWeight: 600 } }, from),
      h('span', { style: { color: '#6b7280' } }, '→'),
      h('span', { style: { fontWeight: 600 } }, to),
      h('span', {
        'data-state-pill': state,
        style: {
          marginLeft: 'auto',
          padding: '1px 8px',
          borderRadius: 10,
          background: accent,
          color: 'white',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
        },
      }, state),
    ),
    task ? h('div', { style: { color: '#1f2937', marginBottom: 6 } }, task) : null,
    reason ? h('div', { style: { color: '#6b7280', fontSize: 11, marginBottom: 4 } }, `reason: ${reason}`) : null,
    contextRefs.length > 0
      ? h('div', { style: { fontSize: 11, color: '#4b5563' } }, `context: ${contextRefs.join(', ')}`)
      : null,
    artifacts.length > 0
      ? h('div', { style: { fontSize: 11, color: '#059669', marginTop: 4 } }, `produced: ${artifacts.join(', ')}`)
      : null,
  );
}
