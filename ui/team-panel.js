/**
 * team-panel.js — Slot registration for the Team Plugin UI.
 *
 * Per architecture.md §7.1, this plugin introduces two new slots:
 *   - `team-panel`  (list)  — the常驻面板 root component
 *   - `team-config` (keyed) — the Team / Role / Member configuration centre
 *
 * v1.0 scope: register the slots with placeholder components so the wiring
 * is in place. The actual rendered UI is P1+ work (Linear-flavoured app
 * shell, member chips, decision-point badge, handoff cards, handoff-redo
 * variant — see architecture §7.3 for the full list).
 *
 * The DSH host's `ctx.slots.listSubTree()` will pick up these registrations
 * as soon as the plugin is loaded; the host renders them once a UI consumer
 * starts reading the slot.
 *
 * @module dsh-team-plugin/team-panel
 */

/**
 * Minimal placeholder component. v1.0 uses `React.createElement` (per
 * dsh-dual-plugin-guide core-api.md) instead of JSX because Cordis plugins
 * are loaded into a non-transpilation context. When the UI layer is
 * implemented in P1, this stub will be replaced with a real component
 * that subscribes to `TeamService.runStore` and renders the active
 * Team list.
 *
 * @param {Record<string, unknown>} [props]
 * @returns {unknown}
 */
function placeholderPanel(props) {
  const React = /** @type {any} */ (globalThis).React;
  if (typeof React?.createElement !== 'function') {
    // Outside a React-loaded runtime (e.g. unit test), return a no-op marker
    // that callers can identify.
    return { __placeholder: 'team-panel', props: props ?? {} };
  }
  return React.createElement(
    'div',
    { 'data-dsh-team-panel': 'v1-stub', style: { padding: 8, color: '#888' } },
    `DSH Team Panel — v1.0 P0 stub (props: ${Object.keys(props ?? {}).join(', ')})`,
  );
}

/**
 * Register all team-plugin slots against the host slot registry.
 * Effect-wrapped: the disposer from `ctx.slots.register(...)` runs when
 * the Cordis plugin unloads.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function registerTeamSlots(ctx) {
  if (!ctx.slots || typeof ctx.slots.register !== 'function') {
    ctx.logger?.warn?.('dsh-team-plugin: ctx.slots unavailable; slot registration skipped');
    return;
  }
  // 常驻面板 (list) — collects sub-entries (chips / badges / cards) keyed
  // by member_id / dispatch_id. The actual collection is a P1 concern; here
  // we register an empty list slot so consumers can find it.
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-panel',
      kind: 'list',
      component: placeholderPanel,
      label: 'DSH Team',
    }),
  );
  // Team 配置中心 (keyed) — Role / Member / Team-Template 编辑入口。P1+
  // 实现真正的表单组件；这里只占位。
  ctx.effect(() =>
    ctx.slots.register({
      name: 'team-config',
      kind: 'keyed',
      component: placeholderPanel,
      label: 'DSH Team Config',
    }),
  );
  // settings 入口 — 让用户能在 DSH 的 settings 页面看到 "Team" 一项。
  // 通过复用 `settings.section` slot（dsh-dual-plugin-guide/slots.md 推荐
  // 入口），不需要新建顶层 slot。
  ctx.effect(() =>
    ctx.slots.register({
      name: 'settings.section',
      kind: 'list',
      component: placeholderPanel,
      label: 'Team',
      props: { sectionId: 'dsh-team', title: 'DSH Team Plugin' },
    }),
  );
}
