/**
 * team-decision-badge.js — corner badge on the Team status pill +
 * "无推进" 暗示 (B7).
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
 * 2.0 B7 revision:
 *   - When the run is in `running` but the dispatch is paused (no
 *     dispatch-log row in the last 5 min while a member is joined),
 *     surface a "no-progress" indicator on the badge. This is the
 *     "session 保活但无推进" hint (architecture §9.6.4). The host
 *     passes `idleForMs` and `isPaused` props; the badge combines the
 *     "DP waiting" + "no-progress" states into a single small marker
 *     so the user gets one signal to scan.
 *
 * @module dsh-team-plugin/ui/team-decision-badge
 */

import { createElement as h, tokens } from './_react.js';

/**
 * @param {{
 *   waitingCount: number,    // 0 = no badge rendered
 *   kinds?: string[],         // 'convergence' | 'fallback' | 'ad-hoc'
 *   runId?: string,
 *   isPaused?: boolean,       // B7: "no-progress" hint (no dispatch in 5min)
 *   idleForMs?: number,       // ms since last dispatch; used to colour the hint
 * }} props
 */
export function TeamDecisionBadge(props) {
  const { waitingCount = 0, kinds = [], runId, isPaused = false, idleForMs = 0 } = props;
  if (waitingCount <= 0 && !isPaused) return null;
  const label = waitingCount > 0
    ? (kinds.length === 1 ? kinds[0] : `${waitingCount}`)
    : '…';
  // B7 colour: amber (waiting) or muted yellow (paused, no progress)
  const bg = waitingCount > 0 ? tokens.color.warning : tokens.color.warningSoft;
  const fg = waitingCount > 0 ? 'white' : tokens.color.text;
  return h(
    'span',
    {
      className: 'dsh-team-decision-badge',
      'data-waiting-count': waitingCount,
      'data-kinds': kinds.join(','),
      'data-run-id': runId,
      'data-paused': isPaused ? 'true' : 'false',
      'data-idle-ms': idleForMs,
      title: isPaused && waitingCount === 0
        ? `无推进 ${(idleForMs / 1000).toFixed(0)}s`
        : `决策点等待 (${kinds.join(', ')})`,
      style: {
        display: 'inline-block',
        minWidth: 16,
        height: 16,
        padding: '0 5px',
        borderRadius: tokens.radius.md,
        background: bg,
        color: fg,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.semibold,
        lineHeight: '16px',
        textAlign: 'center',
        marginLeft: 4,
        verticalAlign: 'top',
      },
    },
    label,
  );
}
