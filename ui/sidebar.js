/**
 * sidebar.js — 左 sidebar (B3).
 *
 * Per architecture §7.1 + PROGRESS.md §2.0 B3:
 *   - 活跃 Team 列表 (state ∈ non-terminal)
 *   - 历史 Team 折叠区 (state ∈ terminal + archived)
 *   - 素材库入口 (link to team-config slot)
 *
 * The component registers to the `client-ui-sidebar` slot. It is
 * render-only; the host resolves the run list from team-service
 * and passes it as a prop. Clicking a Team in the list is the host's
 * responsibility (a `data-run-id` attribute is set on each row so
 * the host's React tree can wire an onClick).
 *
 * @module dsh-team-plugin/ui/sidebar
 */

import { createElement as h, tokens } from './_react.js';

/** @typedef {{
 *   id: string,
 *   state: string,
 *   flow: string,
 *   task_description: string,
 *   created_at: string,
 *   degraded_flag?: boolean,
 * }} SidebarRun
 */

/** @typedef {{
 *   activeRuns?: SidebarRun[],
 *   historicalRuns?: SidebarRun[],
 *   libraryHref?: string,        // host-resolved URL for the library
 *   selectedRunId?: string,
 *   onSelectRun?: (runId: string) => void,
 *   onOpenLibrary?: () => void,
 * }} Props
 */

const TERMINAL = new Set(['succeeded', 'failed', 'aborted', 'interrupted']);

/**
 * @param {SidebarRun | undefined} r
 */
function stateColor(r) {
  if (!r) return tokens.color.muted;
  return tokens.color.state[/** @type {keyof typeof tokens.color.state} */ (r.state)]
    ?? tokens.color.muted;
}

/**
 * @param {SidebarRun} r
 * @param {string} [selectedRunId]
 * @param {(id: string) => void} [onSelectRun]
 */
function renderRunRow(r, selectedRunId, onSelectRun) {
  const isSelected = r.id === selectedRunId;
  return h(
    'div',
    {
      key: r.id,
      className: 'dsh-team-sidebar-row',
      'data-run-id': r.id,
      'data-state': r.state,
      'data-selected': isSelected ? 'true' : 'false',
      onClick: onSelectRun ? () => onSelectRun(r.id) : undefined,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: tokens.space.sm,
        padding: `${tokens.space.sm}px ${tokens.space.md}px`,
        background: isSelected ? tokens.color.accentSoft : 'transparent',
        borderLeft: isSelected ? `3px solid ${tokens.color.accent}` : '3px solid transparent',
        borderRadius: tokens.radius.sm,
        cursor: onSelectRun ? 'pointer' : 'default',
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
        fontFamily: tokens.font.family,
      },
    },
    h('span', {
      'data-row-state-pill': r.state,
      style: {
        width: 6, height: 6, borderRadius: tokens.radius.pill, background: stateColor(r), flex: '0 0 auto',
      },
    }),
    h('div', { style: { flex: '1 1 auto', minWidth: 0, overflow: 'hidden' } },
      h('div', { 'data-row-task': true, style: { fontWeight: tokens.font.weight.medium, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
        r.task_description?.slice(0, 30) ?? r.id,
      ),
      h('div', { 'data-row-meta': true, style: { fontSize: tokens.font.size.xs, color: tokens.color.muted } },
        `${r.flow} · ${r.id}`,
      ),
    ),
    r.degraded_flag
      ? h('span', { 'data-row-degraded': true, style: { color: tokens.color.warning, fontSize: tokens.font.size.xs } }, '⚠')
      : null,
  );
}

/**
 * @param {{
 *   title: string,
 *   count: number,
 *   defaultOpen?: boolean,
 *   children: any,
 * }} props
 */
function CollapsibleSection(props) {
  const { title, count, defaultOpen = true, children } = props;
  return h(
    'div',
    { className: 'dsh-team-sidebar-section', 'data-section': title.toLowerCase() },
    h('div', {
      className: 'dsh-team-sidebar-section-header',
      'data-section-header': true,
      style: {
        padding: `${tokens.space.sm}px ${tokens.space.md}px`,
        fontSize: tokens.font.size.xs,
        fontWeight: tokens.font.weight.semibold,
        color: tokens.color.muted,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        borderTop: `1px solid ${tokens.color.border}`,
      },
    },
      title,
      h('span', { 'data-section-count': true, style: { marginLeft: tokens.space.xs, color: tokens.color.muted } }, String(count)),
    ),
    defaultOpen
      ? h('div', { className: 'dsh-team-sidebar-section-body', 'data-section-body': true, style: { display: 'flex', flexDirection: 'column', gap: 2 } }, children)
      : null,
  );
}

/**
 * @param {Props} props
 */
export function TeamSidebar(props) {
  const active = (props?.activeRuns ?? []).filter((r) => !TERMINAL.has(r.state));
  const historical = (props?.historicalRuns ?? []).filter((r) => TERMINAL.has(r.state));
  const selectedRunId = props?.selectedRunId;
  const onSelectRun = props?.onSelectRun;
  return h(
    'div',
    {
      className: 'dsh-team-sidebar',
      'data-component': 'sidebar',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: tokens.space.sm,
        padding: tokens.space.sm,
        background: tokens.color.surface,
        borderRight: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
        height: '100%',
        overflow: 'auto',
      },
    },
    h(CollapsibleSection, { title: 'Active', count: active.length, defaultOpen: true },
      active.length === 0
        ? h('div', { 'data-section-empty': 'active', style: { color: tokens.color.muted, fontSize: tokens.font.size.sm, padding: `${tokens.space.sm}px ${tokens.space.md}px`, fontStyle: 'italic' } },
          'No active Team.')
        : active.map((r) => renderRunRow(r, selectedRunId, onSelectRun)),
    ),
    h(CollapsibleSection, { title: 'History', count: historical.length, defaultOpen: false },
      historical.length === 0
        ? h('div', { 'data-section-empty': 'history', style: { color: tokens.color.muted, fontSize: tokens.font.size.sm, padding: `${tokens.space.sm}px ${tokens.space.md}px`, fontStyle: 'italic' } },
          'No history yet.')
        : historical.map((r) => renderRunRow(r, selectedRunId, onSelectRun)),
    ),
    h('div', {
      className: 'dsh-team-sidebar-library',
      'data-section': 'library',
      style: {
        marginTop: 'auto',
        padding: tokens.space.md,
        borderTop: `1px solid ${tokens.color.border}`,
      },
    },
      h('a', {
        href: props?.libraryHref ?? '#',
        onClick: props?.onOpenLibrary ? (e) => { e?.preventDefault?.(); props.onOpenLibrary(); } : undefined,
        'data-sidebar-library-link': true,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: tokens.space.sm,
          padding: `${tokens.space.sm}px ${tokens.space.md}px`,
          fontSize: tokens.font.size.sm,
          color: tokens.color.accent,
          textDecoration: 'none',
          border: `1px solid ${tokens.color.accentSoft}`,
          borderRadius: tokens.radius.md,
          background: tokens.color.surface,
        },
      },
        '⚙ 素材库 (Role / Member / Template)',
      ),
    ),
  );
}

/**
 * Register the sidebar slot.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerSidebarSlot(ctx) {
  if (!ctx?.slots || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; sidebar slot registration skipped');
    return;
  }
  ctx.effect(() =>
    ctx.slots.register({
      name: 'client-ui-sidebar',
      kind: 'list',
      component: TeamSidebar,
      label: 'DSH Team Sidebar',
    }),
  );
}
