/**
 * dsh-team-plugin dsh bundle entry.
 *
 * Per dsh-dual-plugin-guide: static plugins do their work in `apply(ctx)`.
 * Every registration is effect-wrapped so the disposer runs on unload.
 *
 * Wiring (v1.0 + 2.0 #3):
 *   1. Read every SKILL.md under skills/ and register each with ctx.skills.
 *   2. Register the team.* plugin tools (team.start / team.list / team.abort)
 *      via ctx.tools.register(defineTool(...)).
 *   3. Register the team-panel / team-config / team-plan slots via
 *      ui/team-panel.js.
 *   3b. Bridge DecisionPointService's open/respond events onto the ctx
 *      event bus so the host's React tree (team-decision-badge) gets
 *      live updates (P1.5-b; see PROGRESS.md).
 *   3c. Adapter provider registration (architecture §10.1) — verify-only;
 *      the actual `ctx.subagents.registerProvider` calls live in
 *      `@deepseek-ai/dsh-subagent-acp` instances declared in
 *      `cordis.patch.yml`.
 *   3d. Cross-plugin service registration (2.0 #3; PROGRESS.md §2): publish
 *      a single frozen composite object as `ctx.team` so other plugins can
 *      do `const t = ctx.get('team'); t.members.list(); t.decisions.waitingDecisions(...);`.
 *      Uses Cordis's `ctx.provide(name, value)` (vendor/cordis/src/reflect.ts#provide),
 *      effect-wrapped so the disposer runs on plugin unload.
 *   4. Subscribe to `host/boot` and run reconcileOnBoot() to mark orphaned
 *      runs as `interrupted` (architecture §6.2).
 *
 * Services (paths / log-writer / team-service / role-service / etc.) are
 * plain ES modules under `services/`. From 2.0 #3 onward they are ALSO
 * published as a single composite under the `team` Cordis service name,
 * so cross-plugin code can resolve them via `ctx.get('team')` without
 * reaching into our private file layout.
 *
 * @module dsh-team-plugin
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-team-plugin-skill';
export const inject = ['skills', 'tools'];

const PACKAGE_ROOT = new URL('..', import.meta.url);
const SKILLS_DIR = new URL('../skills/', import.meta.url);

/** Minimal YAML-frontmatter parser for name / description / whenToUse. */
function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return null;
  const fm = match[1];
  const get = (key) => {
    const line = fm.match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    if (!line) return undefined;
    let value = line[1].trim();
    const quoted =
      value.startsWith('"') && value.endsWith('"') ||
      value.startsWith("'") && value.endsWith("'");
    if (quoted) value = value.slice(1, -1);
    return value;
  };
  return { name: get('name'), description: get('description'), whenToUse: get('whenToUse') };
}

/** Walk skills/ and return one entry per <skill-name>/SKILL.md found. */
function listSkillFiles() {
  const dir = fileURLToPath(SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => {
      const subdir = `${dir}${entry}`;
      return statSync(subdir).isDirectory() && existsSync(`${subdir}/SKILL.md`);
    })
    .map((entry) => ({ name: entry, path: new URL(`./${entry}/SKILL.md`, SKILLS_DIR) }));
}

export async function apply(ctx) {
  // --- 1. Skill registration -------------------------------------------------
  const skills = listSkillFiles();
  if (skills.length === 0) {
    ctx.logger.warn('dsh-team-plugin: no skills/ entries found; nothing to register');
  }
  for (const { name: skillName, path: skillFile } of skills) {
    let raw;
    try {
      raw = readFileSync(skillFile, 'utf-8');
    } catch (error) {
      ctx.logger.error(`dsh-team-plugin: cannot read ${skillFile.pathname}: ${error.message}`);
      continue;
    }
    const meta = parseFrontmatter(raw);
    if (!meta?.name || !meta?.description) {
      ctx.logger.error(
        `dsh-team-plugin: ${skillFile.pathname} missing name/description in frontmatter; skill not registered`,
      );
      continue;
    }
    const content = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trimStart();
    ctx.logger.info(`dsh-team-plugin: registered skill "${meta.name}"`);
    ctx.effect(() =>
      ctx.skills.register({
        name: meta.name,
        description: meta.description,
        ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
        content,
        source: 'runtime',
        resourceBase: { kind: 'directory', path: new URL(`./${skillName}/`, SKILLS_DIR).pathname },
      }),
    );
  }

  // --- 2. Plugin tool registration -------------------------------------------
  if (ctx.tools && typeof ctx.tools.register === 'function') {
    // defineTool is the standard wrapper for static-plugin tools. It is
    // optional (the raw object is also accepted for some hosts) but the
    // dsh-dual-plugin-guide / tools.md reference recommends always using it
    // for schema validation + default normalisation.
    let defineTool = /** @type {((def: any) => any) | undefined} */ (undefined);
    try {
      ({ defineTool } = await import('@deepseek-ai/dsh-tools'));
    } catch {
      ctx.logger.warn(
        'dsh-team-plugin: @deepseek-ai/dsh-tools not installed; registering raw tool defs',
      );
    }
    const { teamTools } = await import('./tools/team-tools.js');
    for (const def of teamTools) {
      // v2.0 #1 留口 flow engine rewiring: wrap the tool's execute so the
      // DSH Cordis ctx is closed over and surfaced as `args.__dshCtx`.
      // team.start reads it to pass through to flowSvc.run(); the rest of
      // the team.* tools don't need it but the wrapper is uniform so
      // future tools can opt in without re-plumbing. Per PROGRESS.md
      // handoff note: "wrap the tool at registration time, not by mutating
      // the tool shape" — we keep the public `execute(args)` signature
      // and add an underscore-prefixed key, which the schema validator
      // strips as an unknown property (additionalProperties: false on
      // every team.* tool makes it inert even if it leaks through).
      const wrappedDef = (def.execute && def.execute.constructor === Function)
        ? { ...def, execute: (args) => def.execute({ ...(args ?? {}), __dshCtx: ctx }) }
        : def;
      const wrapped = defineTool ? defineTool(wrappedDef) : wrappedDef;
      ctx.effect(() => ctx.tools.register(wrapped));
      ctx.logger.info(`dsh-team-plugin: registered tool "${def.name}"`);
    }
  } else {
    ctx.logger.warn('dsh-team-plugin: ctx.tools unavailable; team.* tools not registered');
  }

  // --- 3. UI slot registration -----------------------------------------------
  // Slots are a CLIENT-UI service; the host process has no `ctx.slots`
  // (verified in MEMORY: web profile is host, slots live in the browser
  // half). The host therefore does not register any slots here.
  //
  // The actual slot wiring lives in `src/client.js`, bundled to
  // `lib/client.js` by `scripts/build-client.mjs`, exposed via
  // `exports["./client"]` + the `dsh.client` declaration in
  // `package.json`. The host's `client-modules` service auto-discovers
  // it on plugin load and serves it at `/plugins/<id>/client.js`.
  //
  // The `register*Slot` functions exported by `ui/*.js` are still
  // import-safe in a host context (they early-return on missing
  // `ctx.slots.inject`), so a future host-side slot capability would
  // activate them without code changes — but for now they no-op here.

  // --- 3b. Adapter provider registration (architecture §10.1) ---------------
  try {
    const { registerAdapters } = await import('../services/adapters.js');
    registerAdapters(ctx);
  } catch (error) {
    ctx.logger.warn?.(`dsh-team-plugin: adapter registration skipped: ${error.message}`);
  }

  // --- 3c. DecisionPointService -> ctx event bridge (P1.5-b) ---------------
  // The host's React tree (team-decision-badge) listens on
  // `team/decision-point-open` / `-respond` for live updates. We forward
  // the in-process DP registry events onto the Cordis event bus so the
  // panel re-renders without polling. The bridge is effect-scoped, so
  // the listener is removed when the plugin unloads.
  ctx.effect(() => wireDecisionPointBridge(ctx));

  // --- 3d. Cross-plugin service bundle (2.0 #3; PROGRESS.md §2) -----------
  // Publish a single composite object under the `team` Cordis service
  // name so other plugins can do
  //   const t = ctx.get('team');
  //   t.members.list();
  //   t.decisions.waitingDecisions(runId);
  //   t.artifacts.register({...});
  // without reaching into our private file layout. The registration is
  // effect-wrapped (Cordis `provide` itself wraps in `ctx.fiber.effect`),
  // so the service is removed automatically when this plugin unloads.
  // The smoke-test scenario (no DSH runtime) is handled inside the helper
  // by short-circuiting when `ctx.provide` is missing.
  try {
    await registerTeamServices(ctx);
  } catch (error) {
    ctx.logger?.warn?.(
      `dsh-team-plugin: team service registration skipped: ${error.message}`,
    );
  }

  // --- 4. Startup reconciliation (architecture §6.2) -------------------------
  // DSH fires `host/boot` once per process start. The plugin runs the
  // reconcile **only on that signal** (idempotent on subsequent fires if
  // any) so test harnesses that mount/unmount the plugin don't double-run.
  let reconciled = false;
  ctx.on('host/boot', async () => {
    if (reconciled) return;
    reconciled = true;
    try {
      const { reconcileOnBoot } = await import('../services/team-service.js');
      const result = await reconcileOnBoot();
      if (result.interrupted.length > 0) {
        ctx.logger.warn(
          `dsh-team-plugin: reconcileOnBoot marked ${result.interrupted.length} run(s) as interrupted: ${result.interrupted.join(', ')}`,
        );
      } else {
        ctx.logger.info('dsh-team-plugin: reconcileOnBoot found no orphaned runs');
      }
    } catch (error) {
      ctx.logger.error(`dsh-team-plugin: reconcileOnBoot failed: ${error.message}`);
    }
  });

  void PACKAGE_ROOT;
}

/**
 * Bridge DecisionPointService events onto the Cordis event bus so the
 * host's React tree (team-decision-badge) can subscribe via
 * `ctx.on('team/decision-point-open' | '-respond', ...)` and re-render
 * without polling. Returns a disposer; safe to invoke multiple times.
 *
 * Per PROGRESS.md P1.5-b.
 *
 * @param {{
 *   on?: (event: string, handler: (dp: any) => void) => () => void,
 *   emit?: (event: string, payload: any) => void,
 *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void },
 * }} ctx
 * @returns {Promise<() => void>} disposer that removes the bridge
 */
export async function wireDecisionPointBridge(ctx) {
  if (!ctx || typeof ctx.on !== 'function' || typeof ctx.emit !== 'function') {
    return () => {};
  }
  let dpSvc;
  try {
    dpSvc = await import('../services/decision-point-service.js');
  } catch (error) {
    ctx.logger?.warn?.(`dsh-team-plugin: DP event bridge skipped: ${error.message}`);
    return () => {};
  }
  const offOpen = dpSvc.on('open', (dp) => {
    try { ctx.emit('team/decision-point-open', dp); } catch { /* emit errors must not break the panel */ }
  });
  const offRespond = dpSvc.on('respond', (dp) => {
    try { ctx.emit('team/decision-point-respond', dp); } catch { /* emit errors must not break the panel */ }
  });
  ctx.logger?.info?.('dsh-team-plugin: decision-point event bridge active');
  return () => {
    try { offOpen(); } catch { /* disposer errors must not break the panel */ }
    try { offRespond(); } catch { /* disposer errors must not break the panel */ }
  };
}

/**
 * Build the frozen team service bundle from the six service modules under
 * `services/`. The bundle is the value published at `ctx.team` (PROGRESS.md
 * §2.0 #3). Exposed for the smoke test, which runs without a DSH runtime
 * and therefore cannot rely on `ctx.provide`.
 *
 * Module imports use dynamic `import()` so the helper can be called from
 * both the plugin entry (after `apply()`) and from outside-DSH tests
 * without changing the import graph. Modules are loaded in parallel via
 * `Promise.all`; the second-and-later calls resolve from the module cache
 * so the parallel cost is paid only on the first invocation.
 *
 * The returned object is frozen: downstream code may read the service
 * modules off it but cannot accidentally re-bind any property. Frozen
 * status is a contract for cross-plugin code, not a security boundary.
 *
 * @returns {Promise<{
 *   team: typeof import('../services/team-service.js'),
 *   members: typeof import('../services/member-service.js'),
 *   decisions: typeof import('../services/decision-point-service.js'),
 *   messages: typeof import('../services/message-service.js'),
 *   plans: typeof import('../services/plan-service.js'),
 *   artifacts: typeof import('../services/artifact-registry.js'),
 * }>}
 */
export async function createTeamServiceBundle() {
  const [team, members, decisions, messages, plans, artifacts] = await Promise.all([
    import('../services/team-service.js'),
    import('../services/member-service.js'),
    import('../services/decision-point-service.js'),
    import('../services/message-service.js'),
    import('../services/plan-service.js'),
    import('../services/artifact-registry.js'),
  ]);
  return Object.freeze({ team, members, decisions, messages, plans, artifacts });
}

/**
 * Register the team service bundle on `ctx` under the name `team`.
 *
 * Other plugins can then do:
 *   const t = ctx.get('team');
 *   t.members.list();
 *   t.decisions.waitingDecisions(runId);
 *   t.artifacts.register({...});
 *
 * The actual API used is `ctx.provide(name, value)` (Cordis
 * `vendor/cordis/src/reflect.ts`#provide; the method is mixed onto
 * `ctx` by the runtime, see `reflect.ts#mixin('reflect', ['provide', ...])`).
 * The call is effect-wrapped so the disposer Cordis returns runs on
 * plugin unload, removing the service from the live context.
 *
 * Guarded for the no-runtime smoke-test scenario: when `ctx.provide` or
 * `ctx.effect` is missing the helper returns a no-op disposer instead
 * of throwing. This mirrors the no-op pattern in `wireDecisionPointBridge`.
 *
 * @param {{
 *   provide?: (name: string, value: any) => any,
 *   effect?: (callback: () => any, label?: string) => any,
 *   logger?: { info?: (...args: any[]) => void, warn?: (...args: any[]) => void },
 * }} ctx
 * @returns {Promise<() => void>} a disposer (no-op when ctx lacks the API)
 */
export async function registerTeamServices(ctx) {
  if (!ctx || typeof ctx.provide !== 'function' || typeof ctx.effect !== 'function') {
    return () => {};
  }
  const bundle = await createTeamServiceBundle();
  ctx.effect(() => ctx.provide('team', bundle));
  ctx.logger?.info?.('dsh-team-plugin: team service bundle registered on ctx.team');
  return () => {};
}
