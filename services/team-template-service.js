/**
 * team-template-service.js — Team template read.
 *
 * Per architecture.md §5.2: TeamTemplate = { id, name, flow, flow_config,
 * members (member 引用 + instance_alias) }，全局或项目级。删除前引用检查。
 *
 * v1.0 scope: read + list. P1+ adds create / update / delete + the team-config
 * UI form.
 *
 * @module dsh-team-plugin/team-template-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths } from './paths.js';

/** @typedef {{
 *   id: string,
 *   name: string,
 *   flow: 'handoff-round-table'|'pipeline-with-feedback'|'fan-out-collect',
 *   flow_config: Record<string, unknown>,
 *   members: Array<{ member_id: string, instance_alias: string }>,
 * }} TeamTemplate
 */

/** @returns {Promise<TeamTemplate[]>} */
export async function list() {
  const dir = getTeamPaths().templatesDir;
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of entries) {
    const t = await get(f.replace(/\.json$/, ''));
    if (t) out.push(t);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {string} id @returns {Promise<TeamTemplate | undefined>} */
export async function get(id) {
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) return undefined;
  const path = join(getTeamPaths().templatesDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {TeamTemplate} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}
