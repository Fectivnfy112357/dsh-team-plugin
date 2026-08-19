/**
 * team-member-chip.js — single Member chip on the Team Panel member bar.
 *
 * Per architecture.md §7.2 (主区成员栏): horizontal chips, status dot
 * distinguishes busy / idle. Avatar colour = adapter (hermes / mcode /
 * claude-code), shape = role type (default geometry only, per
 * requirements.md §2.1).
 *
 * v1.0 scope: static visual. Real-time status (busy / idle) is wired via
 * the `state` prop, which the panel derives from MemberService + the
 * dispatch log. P1.5+ adds live state subscription.
 *
 * @module dsh-team-plugin/ui/team-member-chip
 */

import { createElement as h } from './_react.js';

/**
 * @param {{
 *   memberId: string,
 *   displayName: string,
 *   roleId: string,
 *   adapter: 'hermes'|'mcode'|'claude-code',
 *   state: 'idle'|'working'|'degraded'|'offline',
 *   instanceAlias?: string,
 *   avatarColor?: string,
 *   avatarShape?: 'circle'|'square'|'triangle',
 * }} props
 */
export function TeamMemberChip(props) {
  const {
    memberId,
    displayName,
    roleId,
    adapter,
    state = 'idle',
    instanceAlias,
    avatarColor,
    avatarShape = 'circle',
  } = props;
  const stateColor = {
    idle: '#9ca3af',
    working: '#22c55e',
    degraded: '#f59e0b',
    offline: '#ef4444',
  }[state] ?? '#9ca3af';
  const adapterColor = avatarColor ?? {
    hermes: '#3b82f6',
    mcode: '#a855f7',
    'claude-code': '#ec4899',
  }[adapter] ?? '#6b7280';
  return h(
    'div',
    {
      className: 'dsh-team-member-chip',
      'data-member-id': memberId,
      'data-state': state,
      'data-adapter': adapter,
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 16,
        background: '#f3f4f6',
        fontSize: 13,
        lineHeight: '20px',
        color: '#111827',
      },
    },
    h('span', {
      'data-state-dot': state,
      style: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: stateColor,
        display: 'inline-block',
        flex: '0 0 auto',
      },
    }),
    h('span', {
      'data-avatar': adapter,
      style: {
        width: 16,
        height: 16,
        borderRadius: avatarShape === 'circle' ? '50%' : avatarShape === 'square' ? 3 : 0,
        background: adapterColor,
        display: 'inline-block',
        flex: '0 0 auto',
        transform: avatarShape === 'triangle' ? 'rotate(45deg)' : undefined,
      },
    }),
    h('span', { 'data-display-name': true, style: { fontWeight: 500 } }, displayName),
    instanceAlias ? h('span', { 'data-alias': true, style: { color: '#6b7280', fontSize: 11 } }, `@${instanceAlias}`) : null,
    h('span', { 'data-role-id': true, style: { display: 'none' } }, roleId),
  );
}
