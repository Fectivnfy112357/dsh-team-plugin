/**
 * dsh-team-plugin dsh bundle entry.
 *
 * Reads skills/<name>/SKILL.md from this package, parses the Agent Skills
 * frontmatter (name / description / whenToUse), and registers each skill with
 * ctx.skills so it appears in the DSH agent's skill catalog.
 *
 * Per the dual-format contract (see /dsh-dual-plugin-guide skill):
 *   - SKILL.md is the single source of content; this file only wires it in.
 *   - Skill registration is wrapped in ctx.effect(() => ...) so the disposer
 *     runs automatically when the Cordis plugin is unloaded.
 *
 * P0 scope: skill registration only. Plugin tools (team.start / team.abort /
 * team.list / ...) and Cordis services (TeamService / MemberService / ...) are
 * stubbed or registered in later stages (P1+ per architecture.md §12).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'dsh-team-plugin-skill';
export const inject = ['skills'];

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
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) value = value.slice(1, -1);
    return value;
  };
  return {
    name: get('name'),
    description: get('description'),
    whenToUse: get('whenToUse'),
  };
}

/** Walk skills/ and return one entry per <skill-name>/SKILL.md found. */
function listSkillFiles() {
  const dir = fileURLToPath(SKILLS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => {
      const subdir = `${dir}${entry}`;
      return (
        statSync(subdir).isDirectory() &&
        existsSync(`${subdir}/SKILL.md`)
      );
    })
    .map((entry) => ({
      name: entry,
      path: new URL(`./${entry}/SKILL.md`, SKILLS_DIR),
    }));
}

export function apply(ctx) {
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
    if (!meta || !meta.name || !meta.description) {
      ctx.logger.error(
        `dsh-team-plugin: ${skillFile.pathname} missing name/description in frontmatter; skill not registered`,
      );
      continue;
    }
    const content = raw
      .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
      .trimStart();
    ctx.logger.info(`dsh-team-plugin: registered skill "${meta.name}"`);
    ctx.effect(() =>
      ctx.skills.register({
        name: meta.name,
        description: meta.description,
        ...(meta.whenToUse ? { whenToUse: meta.whenToUse } : {}),
        content,
        source: 'runtime',
        resourceBase: {
          kind: 'directory',
          path: new URL(`./${skillName}/`, SKILLS_DIR).pathname,
        },
      }),
    );
  }

  // P0 stub: nothing more yet. Subsequent stages wire up:
  //   - TeamService / MemberService / DispatchService / etc. (P1+)
  //   - team.* plugin tools (team.start / team.abort / team.list / ...) (P1+)
  //   - Cordis host/boot listener for reconcileOnBoot (P0 §6.2)
  //   - team-panel / team-config UI slots (P1+)
  void PACKAGE_ROOT;
}
