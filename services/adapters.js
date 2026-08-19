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
 * The actual subagent runtime registration goes through
 * `ctx.subagents` in the live DSH host (subagent named provider
 * registry). In v1.0 the test surface is the list shape; production
 * surfaces this list to subagent-acp at plugin apply() time.
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
 * Register the three adapters against the live subagent registry if
 * available. v1.0 no-op when subagent runtime is absent (unit tests);
 * production surfaces the registered providers to `ctx.subagents`.
 * @param {any} ctx - Cordis ctx (or null for tests)
 */
export function registerAdapters(ctx) {
  if (!ctx || !ctx.subagents) return [];
  const registered = [];
  for (const [id, def] of Object.entries(ADAPTERS)) {
    try {
      // Real registration depends on the subagent named provider API
      // (e.g. `ctx.subagents.registerProvider(def.provider, {...})`).
      // v1.0 keeps the surface documented; the actual call is a P0+ hook.
      if (typeof ctx.subagents.registerProvider === 'function') {
        ctx.subagents.registerProvider(def.provider, def);
      }
      registered.push({ id, ...def });
    } catch (e) {
      ctx.logger?.warn?.(`adapters: failed to register ${id}: ${e.message}`);
    }
  }
  return registered;
}
