/**
 * src/client.js — DSH client-UI entry for dsh-team-plugin.
 *
 * Per dsh-dual-plugin-guide: this file is the **browser half** of the
 * dual-face package. The host's `client-modules` service reads the
 * `dsh.client` declaration in `package.json` and serves this file (as
 * `lib/client.js`, built by `scripts/build-client.mjs`) at
 * `/plugins/<id>/client.js`. The browser then evaluates it inside the
 * DSH client Cordis runtime.
 *
 * The plugin's `export const inject` declares the hard Cordis-service
 * dependencies. The runtime refuses to activate the plugin if the
 * declared services are not present — `slots` is the only one we need
 * for the current set of registrations (the components are render-only
 * and read state from props; no host RPC, no locale, no sessions).
 *
 * The host-side `lib/index.js` registers skills, tools and services
 * and never touches `ctx.slots` (host has no such service). The two
 * halves are independent Cordis plugins; the host Loader activates
 * the package's `lib/index.js` from `cordis.patch.yml`; the client
 * Loader activates the bundled `lib/client.js` from the `dsh.client`
 * declaration. Both share the same npm package but otherwise run in
 * different processes / Cordis contexts.
 *
 * @module dsh-team-plugin/client
 */

import { registerLayoutSlot } from '../ui/layout.js';
import { registerSidebarSlot } from '../ui/sidebar.js';
import { registerConversationSlot } from '../ui/conversation.js';
import { registerToolSlot } from '../ui/tool.js';
import { registerTeamSlots } from '../ui/team-panel.js';

/** Cordis-service hard dependencies. The runtime gates activation on
 *  these. `slots` is the only one the current registration set needs;
 *  we don't call the host, don't bind a session, don't localise. */
export const inject = ['slots'];

/**
 * Run the per-registrar slot wiring. Each `register*Slot` is
 * effect-wrapped via `ctx.slots.inject(key, ...)` (per Cordis client
 * notes) so the registrations survive slot-owner remounts.
 *
 * The components themselves stay in `ui/*.js`; the bundler inlines
 * them into the single `lib/client.js` so the browser can fetch one
 * self-contained file.
 *
 * @param {{
 *   slots?: { inject: Function, register: Function },
 *   logger?: { warn?: (...args: any[]) => void, info?: (...args: any[]) => void },
 * }} ctx — DSH client Cordis context (subset; full type in
 *   `@deepseek-ai/dsh-client-runtime/client`)
 */
export function apply(ctx) {
  if (!ctx?.slots?.inject) {
    ctx?.logger?.warn?.('dsh-team-plugin/client: ctx.slots.inject unavailable; no client slots registered');
    return;
  }
  // Order is for diagnostic clarity only — the slots are independent
  // so the order is not load-bearing.
  registerLayoutSlot(ctx);
  registerSidebarSlot(ctx);
  registerConversationSlot(ctx);
  registerToolSlot(ctx);
  registerTeamSlots(ctx);
  ctx?.logger?.info?.('dsh-team-plugin/client: registered settings.section (id=team) + shell.overlay (team-topbar / team-footer / team-panel) + sidebar.footer.action (id=team) + conversation.view (id=team-timeline) + tool.call.toolview (29 team.* keys)');
}
