/**
 * role-service.js — Role CRUD (全局素材库).
 *
 * Per architecture.md §5.2: roles are global, no reference check (member
 * snapshots carry the role reference). v1.0 supports read + list; create /
 * update / delete land with the team-config UI in P1+.
 *
 * @module dsh-team-plugin/role-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths } from './paths.js';

/** @typedef {{
 *   id: string,
 *   display_name: string,
 *   persona: string,
 *   adapter: 'hermes'|'mcode'|'claude-code',
 *   cli_options: Record<string, unknown>,
 *   tools_allowed: string[],
 *   avatar: { color: string, shape: string },
 * }} Role
 */

/**
 * List all roles, sorted by id.
 * @returns {Promise<Role[]>}
 */
export async function list() {
  const dir = getTeamPaths().rolesDir;
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of entries) {
    const role = await get(f.replace(/\.json$/, ''));
    if (role) out.push(role);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Read one role by id. Returns undefined if missing.
 * @param {string} id
 * @returns {Promise<Role | undefined>}
 */
export async function get(id) {
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) return undefined;
  const path = join(getTeamPaths().rolesDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {Role} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}
