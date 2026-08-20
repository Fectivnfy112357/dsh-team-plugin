/**
 * user-questions.js — 决策点响应卡片 (B6).
 *
 * Per architecture §7.4 + PROGRESS.md §2.0 B6:
 *   - A decision-point card that the host renders inside the
 *     `client-ui-user-questions` slot. The card combines:
 *       1. the DP prompt text (what the user is being asked),
 *       2. the action three-choice (continue / complete / abort),
 *       3. an optional free-text feedback input.
 *   - Submitting the card calls the `team.respond_decision_point`
 *     tool with the chosen action + feedback. The DSH host wires
 *     the onSubmit callback; the card itself is render-only.
 *
 * Live DP subscription: the host's React useEffect calls
 * `subscribeDps(ctx, setState)` (P1.5-b) and re-renders the
 * card on `team/decision-point-open` / `-respond` events.
 *
 * @module dsh-team-plugin/ui/user-questions
 */

import { createElement as h, tokens } from './_react.js';

/** @typedef {{
 *   id: string,
 *   runId: string,
 *   kind: 'convergence'|'fallback'|'ad-hoc'|'cost-cap'|'pipeline-feedback',
 *   prompt: string,
 *   contextRefs?: string[],
 *   isAdHoc?: boolean,
 *   isAwaiting?: boolean,        // true if the user has not yet responded
 *   defaultAction?: 'continue'|'complete'|'abort',
 * }} DecisionPoint
 */

/**
 * @param {{
 *   dp?: DecisionPoint | null,
 *   error?: string,
 *   onSubmit?: (payload: { dpId: string, action: 'continue'|'complete'|'abort', feedback: string }) => void | Promise<void>,
 * }} props
 */
export function UserQuestionCard(props) {
  const { dp, error, onSubmit } = props;
  if (error) {
    return h(
      'div',
      { className: 'dsh-user-question dsh-user-question--error', 'data-state': 'error', style: { padding: tokens.space.lg, color: tokens.color.danger, fontSize: tokens.font.size.md } },
      `Failed to load decision point: ${error}`,
    );
  }
  if (!dp) {
    return h(
      'div',
      { className: 'dsh-user-question dsh-user-question--empty', 'data-state': 'empty', style: { padding: tokens.space.lg, color: tokens.color.muted, fontSize: tokens.font.size.sm, fontStyle: 'italic' } },
      'No decision point waiting.',
    );
  }
  const isAdHoc = dp.isAdHoc === true;
  return h(
    'div',
    {
      className: 'dsh-user-question',
      'data-dp-id': dp.id,
      'data-dp-kind': dp.kind,
      'data-dp-run-id': dp.runId,
      'data-is-ad-hoc': isAdHoc ? 'true' : 'false',
      'data-state': 'content',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.md,
        padding: tokens.space.lg,
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderLeft: `3px solid ${isAdHoc ? tokens.color.warning : tokens.color.accent}`,
        borderRadius: tokens.radius.md,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
      },
    },
    h('div', { className: 'dsh-user-question-header', style: { display: 'flex', alignItems: 'center', gap: tokens.space.sm } },
      h('span', { 'data-dp-kind-pill': dp.kind, style: { padding: `1px ${tokens.space.sm}px`, borderRadius: tokens.radius.pill, background: isAdHoc ? tokens.color.warningSoft : tokens.color.accentSoft, color: isAdHoc ? tokens.color.warning : tokens.color.accent, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold, textTransform: 'uppercase' } },
        isAdHoc ? 'ad-hoc' : dp.kind,
      ),
      h('span', { 'data-dp-run-id': true, style: { color: tokens.color.muted, fontSize: tokens.font.size.xs } }, dp.runId),
    ),
    h('div', { className: 'dsh-user-question-prompt', 'data-dp-prompt': true, style: { fontSize: tokens.font.size.lg, lineHeight: 1.5 } },
      dp.prompt,
    ),
    Array.isArray(dp.contextRefs) && dp.contextRefs.length > 0
      ? h('div', { className: 'dsh-user-question-context', 'data-dp-context': true, style: { fontSize: tokens.font.size.xs, color: tokens.color.muted } },
        'context: ',
        ...dp.contextRefs.map((r) => h('span', { key: r, 'data-dp-ref': r, style: { marginRight: tokens.space.sm } }, r)),
      )
      : null,
    h('div', { className: 'dsh-user-question-actions', 'data-dp-actions': true, style: { display: 'flex', gap: tokens.space.sm, marginTop: tokens.space.sm } },
      h('button', {
        type: 'button',
        'data-action': 'continue',
        onClick: onSubmit ? () => onSubmit({ dpId: dp.id, action: 'continue', feedback: '' }) : undefined,
        style: actionButtonStyle('continue'),
      }, 'Continue'),
      h('button', {
        type: 'button',
        'data-action': 'complete',
        onClick: onSubmit ? () => onSubmit({ dpId: dp.id, action: 'complete', feedback: '' }) : undefined,
        style: actionButtonStyle('complete'),
      }, 'Complete'),
      h('button', {
        type: 'button',
        'data-action': 'abort',
        onClick: onSubmit ? () => onSubmit({ dpId: dp.id, action: 'abort', feedback: '' }) : undefined,
        style: actionButtonStyle('abort'),
      }, 'Abort'),
    ),
    h('textarea', {
      className: 'dsh-user-question-feedback',
      'data-dp-feedback': true,
      placeholder: 'Optional feedback (constraints / corrections / extra info) — included in the next round\'s dispatch.task',
      rows: 2,
      style: {
        width: '100%',
        padding: tokens.space.sm,
        fontSize: tokens.font.size.md,
        fontFamily: 'inherit',
        border: `1px solid ${tokens.color.border}`,
        borderRadius: tokens.radius.md,
        resize: 'vertical',
      },
    }),
  );
}

/**
 * @param {'continue'|'complete'|'abort'} action
 */
function actionButtonStyle(action) {
  const palette = {
    continue: { bg: tokens.color.accent, fg: 'white' },
    complete: { bg: tokens.color.success, fg: 'white' },
    abort: { bg: tokens.color.danger, fg: 'white' },
  }[action];
  return {
    padding: `${tokens.space.sm}px ${tokens.space.lg}px`,
    fontSize: tokens.font.size.md,
    fontWeight: tokens.font.weight.semibold,
    background: palette.bg,
    color: palette.fg,
    border: 'none',
    borderRadius: tokens.radius.md,
    cursor: 'pointer',
  };
}

// TODO(team-plugin/2.0 backlog): `UserQuestionCard` is NOT registered
// into a slot because the only viable home — `conversation.composer`
// (chain, scope: session) — is already occupied by the shipped
// `client-ui-user-questions QuestionComposer` (catalog:
// `cordis-client-runner/src/client/slot-catalog.ts:337`). Taking the
// chain would replace the shipped composer takeover wholesale and
// break ask_user_question rendering for non-team sessions. The card
// itself is still rendered into the conversation flow as a
// conversation.chat.node key ('team-decision-card', to land in a
// follow-up) and via the host event bridge
// (`team/decision-point-open` from `lib/index.js#wireDecisionPointBridge`).
// `registerUserQuestionsSlot` is therefore a no-op for now; the
// component export stays so future work can re-target the slot
// without re-authoring the JSX.

/**
 * No-op slot registrar. The component is wired through other seams
 * (host event bus, conversation timeline). See the file-level TODO.
 * @param {import('@deepseek-ai/cordis').Context} _ctx
 */
export function registerUserQuestionsSlot(_ctx) {
  // intentionally empty: see file-level TODO.
}
