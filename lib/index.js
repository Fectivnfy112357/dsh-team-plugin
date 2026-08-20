/**
 * dsh-team-plugin dsh bundle entry.
 *
 * Per dsh-dual-plugin-guide: static plugins do their work in `apply(ctx)`.
 * Every registration is effect-wrapped so the disposer runs on unload.
 *
 * Wiring (v1.0):
 *   1. Read every SKILL.md under skills/ and register each with ctx.skills.
 *   2. Register the team.* plugin tools (team.start / team.list / team.abort)
 *      via ctx.tools.register(defineTool(...)).
 *   3. Register the team-panel / team-config slots via ui/team-panel.js.
 *   4. Subscribe to `host/boot` and run reconcileOnBoot() to mark orphaned
 *      runs as `interrupted` (architecture §6.2).
 *
 * Services (paths / log-writer / team-service / role-service / etc.) are
 * plain modules under `services/`. v1.0 does NOT register them as Cordis
 * services; they are imported by the tools and the index entry. A future
 * revision may register them so cross-plugin code can `ctx.get('team')`.
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
      const wrapped = defineTool ? defineTool(def) : def;
      ctx.effect(() => ctx.tools.register(wrapped));
      ctx.logger.info(`dsh-team-plugin: registered tool "${def.name}"`);
    }
  } else {
    ctx.logger.warn('dsh-team-plugin: ctx.tools unavailable; team.* tools not registered');
  }

  // --- 3. UI slot registration -----------------------------------------------
  try {
    const { registerTeamSlots } = await import('../ui/team-panel.js');
    registerTeamSlots(ctx);
  } catch (error) {
    ctx.logger.error(`dsh-team-plugin: failed to register UI slots: ${error.message}`);
  }

  // --- 3b. Adapter provider registration (architecture §10.1) ---------------
  try {
    const { registerAdapters } = await import('../services/adapters.js');
    registerAdapters(ctx);
  } catch (error) {
    ctx.logger.warn?.(`dsh-team-plugin: adapter registration skipped: ${error.message}`);
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
