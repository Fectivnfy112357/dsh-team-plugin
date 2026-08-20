/**
 * adapters.js — Adapter provider registry (Story 1-3 / §6 / §10.1).
 *
 * The DSH Team Plugin targets a CLOSED set of ACP-compatible adapters:
 *   - hermes        -> provider 'acp-hermes'        (exec: 'hermes', args: ['acp'])
 *   - mcode         -> provider 'acp-mcode'         (exec: 'mcode',  args: ['acp'])
 *   - claude-code   -> provider 'acp-claude-code'   (exec: 'claude-agent-acp')
 *
 * v1.0 ships all three as static registrations. The architecture reserves
 * 'opencode' as a future extension point (closed set; users cannot add
 * new adapters without rebuilding the plugin — J decision, §12.1 A3).
 *
 * Provider registration strategy (2.0 #1, see PROGRESS.md):
 *   The actual `ctx.subagents.registerProvider(...)` call lives in the
 *   `@deepseek-ai/dsh-subagent-acp` Cordis plugin itself, NOT in team
 *   plugin code. We declare three instances of that plugin in
 *   `cordis.patch.yml`, each with a distinct `providerName` (acp-hermes,
 *   acp-mcode, acp-claude-code). The DSH host loads them when it
 *   composes its cordis.yml.
 *
 *   What `registerAdapters(ctx)` does: verify the three providerNames
 *   are present on `ctx.subagents` after host composition, and warn
 *   when one is missing. Returning the closed set is the contract the
 *   tests rely on.
 *
 * @module dsh-team-plugin/adapters
 */

/** @typedef {'hermes'|'mcode'|'claude-code'} AdapterId */

/** @type {Record<AdapterId, { provider: string, exec: string, args: string[] }>} */
export const ADAPTERS = Object.freeze({
  hermes: { provider: 'acp-hermes', exec: 'hermes', args: ['acp'] },
  mcode: { provider: 'acp-mcode', exec: 'mcode', args: ['acp'] },
  'claude-code': { provider: 'acp-claude-code', exec: 'claude-agent-acp', args: [] },
});

/** @returns {AdapterId[]} */
export function listAdapterIds() {
  return Object.keys(ADAPTERS);
}

/**
 * Look up an adapter by id. Throws if unknown (caller-facing; v1.0
 * intentionally rejects unknown adapter ids).
 * @param {string} id
 * @returns {{ provider: string, exec: string, args: string[] }}
 */
export function getAdapter(id) {
  const a = ADAPTERS[/** @type {AdapterId} */ (id)];
  if (!a) throw new Error(`adapters: unknown adapter "${id}" (closed set: ${listAdapterIds().join(', ')})`);
  return a;
}

/**
 * Verify the closed adapter set is present on the live subagent runtime
 * and return the resolved records. v1.0 kept the name `registerAdapters`
 * for backward compatibility with `lib/index.js`'s apply() hook, but the
 * actual provider registration is now driven by `cordis.patch.yml` (see
 * the file header for the full strategy). This function:
 *   - returns the closed adapter list (always; this is the test contract),
 *   - when a live `ctx.subagents` is available, verifies each `providerName`
 *     is registered and logs INFO/WARN accordingly,
 *   - never mutates the registry.
 * @param {any} [ctx] - Cordis ctx (or null for tests without DSH runtime)
 * @returns {Array<{ id: AdapterId, provider: string, exec: string, args: string[] }>}
 */
export function registerAdapters(ctx) {
  const closed = /** @type {Array<{ id: AdapterId, provider: string, exec: string, args: string[] }>} */ (
    listAdapterIds().map((id) => /** @type {any} */ ({ id, ...getAdapter(id) }))
  );
  if (!ctx || !ctx.subagents) return closed;
  for (const { id, provider } of closed) {
    try {
      const present =
        typeof ctx.subagents.getProvider === 'function'
          ? ctx.subagents.getProvider(provider) !== undefined
          : typeof ctx.subagents.list === 'function'
            ? ctx.subagents.list().includes(provider)
            : true; // can't tell; assume present
      if (present) {
        ctx.logger?.info?.(`adapters: ${id} (${provider}) present`);
      } else {
        ctx.logger?.warn?.(`adapters: ${id} (${provider}) not registered; check cordis.patch.yml`);
      }
    } catch (e) {
      ctx.logger?.warn?.(`adapters: ${id} verification failed: ${e.message}`);
    }
  }
  return closed;
}
