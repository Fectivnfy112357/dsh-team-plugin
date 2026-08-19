/**
 * team-handoff-redo.js — the red-themed handoff-returned variant.
 *
 * Per architecture.md §7.3 (handoff 退回 row): same shape as the
 * normal handoff card, but with explicit "redo" semantics — used when
 * a Member rejects a handoff and returns the work item with a
 * "需修改清单" feedback (Story 2 pipeline feedback loop).
 *
 * v1.0 re-exports TeamHandoffCard with `variant='redo'`; the visual
 * difference is the colour palette + a "redo" data attribute. P1.5+
 * adds a richer footer (feedback text block).
 *
 * @module dsh-team-plugin/ui/team-handoff-redo
 */

import { createElement as h } from './_react.js';
import { TeamHandoffCard } from './team-handoff-card.js';

/**
 * @param {{
 *   from: string,
 *   to: string,
 *   task?: string,
 *   contextRefs?: string[],
 *   artifacts?: string[],
 *   reason?: string,
 *   feedback?: string,        // Story 2 需修改清单
 *   state?: 'in_flight'|'completed'|'failed'|'interrupted'|'redo',
 * }} props
 */
export function TeamHandoffRedo(props) {
  return h(TeamHandoffCard, {
    ...props,
    variant: 'redo',
    state: props.state ?? 'redo',
  });
}
