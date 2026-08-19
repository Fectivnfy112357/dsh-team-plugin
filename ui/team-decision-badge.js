/**
 * team-decision-badge.js — corner badge on the Team status pill.
 *
 * Per architecture.md §7.4 (决策点 UI): the badge is a SMALL MARKER on
 * the existing Team chip — NOT a new pill, NOT a highlight. The contract
 * is "可扫一眼识别 waiting" (§9.12.1 D7-1). When a DP is open the badge
 * is visible; when there is none it's a no-op (no DOM node).
 *
 * v1.0 scope: read the DP state from props (the panel subscribes to
 * DecisionPointService via the `team/decision-point-open` + `-respond`
 * custom events). Real-time subscription is the panel's job, not the
 * badge's.
 *
 * @module dsh-team-plugin/ui/team-decision-badge
 */

import { createElement as h } from './_react.js';

/**
 * @param {{
 *   waitingCount: number,    // 0 = no badge rendered
 *   kinds?: string[],         // 'convergence' | 'fallback' | 'ad-hoc'
 *   runId?: string,
 * }} props
 */
export function TeamDecisionBadge(props) {
  const { waitingCount = 0, kinds = [], runId } = props;
  if (waitingCount <= 0) return null;
  const label = kinds.length === 1 ? kinds[0] : `${waitingCount}`;
  return h(
    'span',
    {
      className: 'dsh-team-decision-badge',
      'data-waiting-count': waitingCount,
      'data-kinds': kinds.join(','),
      'data-run-id': runId,
      title: `决策点等待 (${kinds.join(', ')})`,
      style: {
        display: 'inline-block',
        minWidth: 16,
        height: 16,
        padding: '0 5px',
        borderRadius: 8,
        background: '#f59e0b',
        color: 'white',
        fontSize: 10,
        fontWeight: 600,
        lineHeight: '16px',
        textAlign: 'center',
        marginLeft: 4,
        verticalAlign: 'top',
      },
    },
    label,
  );
}
