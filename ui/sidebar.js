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
 * Small icon-button component for the DSH main sidebar foot.
 *
 * `sidebar.footer.action` is the seat at the foot of the main DSH
 * sidebar (the rail that already hosts Settings). Each registrant
 * contributes a small icon button — see `ui-cordis CordisPanel` for
 * the model. The host's rail is a flex row of fixed-width buttons
 * (each ~36px) and our `TeamSidebar` (Active / History / Library
 * list) is far too wide; that is why we ship a dedicated icon.
 *
 * For now the icon is a no-op visible marker so users can see the
 * plugin is loaded; a future iteration will hook it to open a
 * `shell.overlay` panel (one entry, position: fixed, toggled by
 * the icon click). See `registerSidebarSlot` for the
 * "intentionally not registering" rationale.
 *
 * @param {{
 *   onClick?: (ev: Event) => void,
 *   title?: string,
 * }} [_props]
 */
export function TeamSidebarFooterIcon(_props) {
  return h(
    'button',
    {
      type: 'button',
      className: 'dsh-team-sidebar-icon',
      'data-component': 'sidebar-icon',
      'data-action': 'team',
      title: 'DSH Team (panel coming once data layer lands — see PROGRESS.md §4 留口)',
      style: {
        appearance: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        border: 'none',
        borderRadius: tokens.radius.md,
        background: 'transparent',
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.lg,
        fontWeight: tokens.font.weight.semibold,
        cursor: 'pointer',
      },
    },
    // The bullet mark mirrors the brand in the topbar so the icon is
    // recognisable as ours without committing to a glyph we're not
    // sure the icon set has on every host platform.
    h('span', {
      'data-icon-mark': true,
      style: {
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: tokens.radius.pill,
        background: tokens.color.accent,
      },
    }),
  );
}

/**
 * Register the Team chrome on the real DSH slots.
 *
 * `sidebar` (kind: single) and `sidebar.workspaces` (kind: single) are
 * both `shadows-shipped-ui` and occupied by `client-ui-sidebar
 * SidebarRoot` / `client-ui-workspace WorkspaceBrowser` — taking them
 * would replace shipped navigation, which is hostile. The clean
 * additive path is one entry on the **real** DSH slot:
 *
 *   1. `sidebar.footer.action` (kind: list, scope: root) — one icon
 *      beside Settings at the sidebar foot. Catalog reference:
 *      `cordis-client-runner/src/client/slot-catalog.ts:1504`. This is
 *      the same seat `client-ui-cordis CordisPanel` takes; the slot is
 *      additive and a fresh `id: 'team'` lands beside the shipped
 *      entry rather than replacing it.
 *
 * (The `shell.overlay` 'team-panel' entry from the v1 commit was
 * removed in this revision — see `registerSidebarSlot` body for the
 * self-positioning gotcha that caused the take-over bug.)
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerSidebarSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== 'function') {
    ctx?.logger?.warn?.('dsh-team-plugin/ui/sidebar: ctx.slots.inject unavailable; team sidebar skipped');
    return;
  }
  // `sidebar.footer.action` (kind: list, scope: root) is the additive
  // seat at the DSH main sidebar foot — the icon-button row that
  // already hosts Settings. Registrants contribute a small icon (NOT
  // a full sidebar list) — see `ui-cordis CordisPanel` for the model.
  // We register a tiny icon button here; a future iteration will hook
  // it to open a `shell.overlay` panel (one entry, position: fixed,
  // toggled by the icon click — see ui-cordis's pattern). For now the
  // icon is a no-op visible marker so users know the plugin is loaded.
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'team',
        order: 50,
        label: 'DSH Team',
      },
      TeamSidebarFooterIcon,
    ),
  );
  // (intentionally NOT registering a `shell.overlay` entry for
  // 'team-panel' in this revision: a list-slot `shell.overlay` child
  // renders inside a `position: absolute; inset: 0` layer and must
  // self-position (top/bottom) or it stacks on top of the whole page
  // and covers the DSH home view. The previous revision did this and
  // the user could not interact with the host. The toggleable panel
  // pattern (icon → state → conditional render) lives in a follow-up
  // commit once the data layer (§4 留口 — `WEB_SETTINGS_NAMESPACES` /
  // typed RPC) lands.)
}
