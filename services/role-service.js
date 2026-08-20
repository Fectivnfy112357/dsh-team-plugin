/**
 * role-service.js — Role CRUD (global library).
 *
 * Per architecture.md §5.2: roles are global. A Role is the **template**
 * that a Member instantiates. Deletion is guarded by ref-count: if any
 * Member snapshots a role_id that matches this role's id, the delete is
 * refused (architecture §9.11.3).
 *
 * Reference check: the architecture states "no reference check" because
 * member **snapshots** carry the role reference — i.e. a frozen copy of
 * the role metadata is embedded in `meta.json.members[].snapshot` at
 * Run creation time. Once snapshotted, deleting the role cannot
 * invalidate the historical Run audit. The only thing a delete could
 * break is the in-memory Member / global Member file: if a Member still
 * references the role via `role_id`, deleting the role would leave the
 * Member dangling. We therefore guard deletion on global Member
 * `role_id` references (in-flight runs don't matter — the snapshot is
 * already in `meta.json`).
 *
 * v1.0 surface: `list` + `get`.
 * v2.0 A1 surface (this revision): `create` / `update` / `delete`
 *   with id + schema + ref-count guards.
 *
 * @module dsh-team-plugin/role-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths, ensureDir } from './paths.js';
import { writeJsonFile } from './log-writer.js';
import { listAdapterIds } from './adapters.js';

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

/** @type {Set<string>} */
const _ADAPTER_IDS = new Set(listAdapterIds());

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Validate the id format. Returns the id when valid, throws otherwise.
 * @param {string} id
 */
export function validateId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('role-service: id is required');
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`role-service: id "${id}" must match ${ID_PATTERN}`);
  }
  return id;
}

/**
 * Validate a Role object's structural shape (not the file system). The
 * returned object is a normalised copy (no missing fields). Throws on
 * any field violation.
 * @param {unknown} role
 * @returns {Role}
 */
export function validateRole(role) {
  if (!role || typeof role !== 'object') {
    throw new Error('role-service: role must be an object');
  }
  const r = /** @type {Record<string, unknown>} */ (role);
  if (typeof r.id !== 'string' || r.id.length === 0) {
    throw new Error('role-service: id is required');
  }
  validateId(r.id);
  if (typeof r.display_name !== 'string' || r.display_name.length === 0) {
    throw new Error(`role-service: role ${r.id} missing display_name`);
  }
  if (typeof r.persona !== 'string') {
    throw new Error(`role-service: role ${r.id} persona must be a string`);
  }
  if (typeof r.adapter !== 'string' || !_ADAPTER_IDS.has(r.adapter)) {
    throw new Error(
      `role-service: role ${r.id} adapter "${String(r.adapter)}" must be one of ${[..._ADAPTER_IDS].join(', ')}`,
    );
  }
  const cli = r.cli_options;
  if (cli == null || typeof cli !== 'object' || Array.isArray(cli)) {
    throw new Error(`role-service: role ${r.id} cli_options must be an object`);
  }
  if (!Array.isArray(r.tools_allowed) || r.tools_allowed.some((t) => typeof t !== 'string')) {
    throw new Error(`role-service: role ${r.id} tools_allowed must be string[]`);
  }
  const av = r.avatar;
  if (!av || typeof av !== 'object') {
    throw new Error(`role-service: role ${r.id} avatar is required`);
  }
  if (typeof av.color !== 'string' || typeof av.shape !== 'string') {
    throw new Error(`role-service: role ${r.id} avatar.color and avatar.shape must be strings`);
  }
  return /** @type {Role} */ ({
    id: r.id,
    display_name: r.display_name,
    persona: r.persona,
    adapter: /** @type {Role['adapter']} */ (r.adapter),
    cli_options: /** @type {Record<string, unknown>} */ ({ ...cli }),
    tools_allowed: r.tools_allowed.slice(),
    avatar: { color: av.color, shape: av.shape },
  });
}

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
 * Read one role by id. Returns undefined if missing or id invalid.
 * @param {string} id
 * @returns {Promise<Role | undefined>}
 */
export async function get(id) {
  if (!id || !ID_PATTERN.test(id)) return undefined;
  const path = join(getTeamPaths().rolesDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {Role} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}

/**
 * Persist a Role to disk. Validates shape and id format. Overwrites
 * any existing file with the same id (caller's responsibility to check
 * via `get` first if the "must not exist" semantics matter).
 * @param {Role | unknown} role
 * @returns {Promise<Role>}
 */
export async function create(role) {
  const normalised = validateRole(role);
  const path = join(getTeamPaths().rolesDir, `${normalised.id}.json`);
  if (existsSync(path)) {
    throw new Error(`role-service.create: role "${normalised.id}" already exists`);
  }
  ensureDir(getTeamPaths().rolesDir);
  await writeJsonFile(path, normalised);
  return normalised;
}

/**
 * Update an existing Role. The id must match an existing file; the
 * id itself is not mutable (caller must delete + create for rename).
 * All other fields are replaced. Re-validates shape and re-writes the
 * file. Throws when the role is missing.
 * @param {string} id
 * @param {Partial<Role>} patch
 * @returns {Promise<Role>}
 */
export async function update(id, patch) {
  validateId(id);
  if (!patch || typeof patch !== 'object') {
    throw new Error(`role-service.update: patch is required for role "${id}"`);
  }
  if (patch.id !== undefined && patch.id !== id) {
    throw new Error(`role-service.update: role id is immutable ("${id}" -> "${patch.id}")`);
  }
  const cur = await get(id);
  if (!cur) {
    throw new Error(`role-service.update: role "${id}" not found`);
  }
  // Merge then re-validate. The id is forced to the on-disk id to
  // prevent caller-supplied id drift from creating a corrupt file.
  const next = validateRole({ ...cur, ...patch, id });
  const path = join(getTeamPaths().rolesDir, `${id}.json`);
  await writeJsonFile(path, next);
  return next;
}

/**
 * Delete a Role by id. Refuses when any global Member file has a
 * `role_id` pointing at this id. Idempotent for the missing case
 * (returns false). Throws when the role exists and is referenced.
 *
 * @param {string} id
 * @returns {Promise<{ deleted: boolean, refs: number, refUsers: string[] }>}
 */
export async function remove(id) {
  validateId(id);
  const cur = await get(id);
  if (!cur) return { deleted: false, refs: 0, refUsers: [] };
  const refUsers = await findMembersReferencingRole(id);
  if (refUsers.length > 0) {
    return { deleted: false, refs: refUsers.length, refUsers };
  }
  const path = join(getTeamPaths().rolesDir, `${id}.json`);
  try {
    await unlink(path);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  return { deleted: true, refs: 0, refUsers: [] };
}

/**
 * Walk the global members dir and return the ids of members whose
 * `role_id` equals the given role id. Lazy-imported MemberService.list
 * keeps the role-service module graph minimal.
 * @param {string} roleId
 * @returns {Promise<string[]>}
 */
async function findMembersReferencingRole(roleId) {
  try {
    const { list: listMembers } = await import('./member-service.js');
    const members = await listMembers();
    return members.filter((m) => m?.role_id === roleId).map((m) => m.id);
  } catch {
    return [];
  }
}

/**
 * Test-only reset. No file system effect; reserved for symmetry with
 * the `_reset*ForTests` helpers in sibling services. Currently a no-op.
 */
export function _resetForTests() { /* no in-memory state */ }
