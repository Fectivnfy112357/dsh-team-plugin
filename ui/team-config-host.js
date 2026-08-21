/**
 * team-config-host.js — settings.section 槽位的 DSH 端 component 适配层。
 *
 * 为什么需要这层：DSH `@deepseek-ai/dsh-client-ui-slots#register` 把 component
 * 当 2nd 参数，渲染时给它的是 `PropsRuntime<'settings.section'>` + 各种
 * `InjectFace` / `PropsLocale` 形态（见 `packages/client/ui-settings/src/client/contract/slots.ts`）。
 * 而我们的 `TeamConfigPanel`（`ui/team-config.js`）是 render-only 组件，
 * 设计上从 `props.roles / members / templates / activeTab / onChangeTab /
 * onSubmit* / onDelete` 这些**静态 prop** 读（写于 2.0 §2 A4 闭环 commit
 * `4f3af37`，当时还是 Cordis 风格的"host 闭包 ctx 然后传 prop"模型）。
 *
 * 现实是 DSH 这边没有把数据流到 `props.roles` 这种 prop 的机制 —— 它给的是
 * runtime 形态（`close: () => void` + 可选 `t` + 可选 `renderSlot` + 可选
 * `useXxx` hooks via inject face）。所以最 honest 的做法是**先让表单真的
 * 渲染出来**（填 no-op callbacks 跳过 loading 分支），数据层留口挂到 §4。
 *
 * 跳过 loading 分支的最小条件（`ui/team-config.js:247-256`）：
 *   roles.length === 0 && members.length === 0 && templates.length === 0
 *   && !props?.onChangeTab && !props?.activeTab
 * —— 传一个 no-op `onChangeTab` 就破。Submit / Delete 全部 no-op 即可。
 *
 * 数据层留口见 PROGRESS.md §4 —— 走 settingsScope 需要 DSH 主机代码
 * (`packages/host/apiproxy/src/api-proxy.ts:126-128` 的
 * `WEB_SETTINGS_NAMESPACES` 白名单) 加 `dsh-team-plugin`；走 `team.*` 工具
 * 需要 client 端有 typed RPC 通道（DSH `IApiClient` 53 个 typed method 全是
 * 显式声明的，没有 `team.*` slot）。**两条都超出本仓 plugin scope**。
 *
 * @module dsh-team-plugin/ui/team-config-host
 */

import { createElement as h } from './_react.js';
import { TeamConfigPanel } from './team-config.js';

/** No-op submit/delete/tab-change handlers. The form renders, the buttons
 *  click, but nothing persists (data layer is on the §4 留口 list). */
const NOOP = () => {};

/**
 * DSH-side component to register on `settings.section`. It is a thin
 * adapter that turns the runtime-only DSH props into the static-data
 * props `TeamConfigPanel` was built for, by supplying no-op callbacks
 * (which is enough to skip the "Loading configuration…" branch) and
 * leaving the data arrays empty (the form will render its built-in
 * empty-state copy for each tab).
 *
 * @param {object} _props - DSH runtime props (`close`, `t`, etc.). Ignored.
 * @returns {any} the TeamConfigPanel vdom.
 */
export function TeamConfigPanelHost(_props) {
  return h(TeamConfigPanel, {
    onChangeTab: NOOP,
    onSubmitRole: NOOP,
    onSubmitMember: NOOP,
    onSubmitTemplate: NOOP,
    onDelete: NOOP,
  });
}
