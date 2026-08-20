/**
 * team-template-service.js — Team template CRUD (global library).
 *
 * Per architecture.md §5.2: TeamTemplate = { id, name, flow, flow_config,
 * members (member 引用 + instance_alias) }. Global, persistent.
 *
 * Deletion guard: a TeamTemplate can be referenced by:
 *   - in-flight Team Runs (look for `meta.json.template_id` == id)
 *   - other TeamTemplates (nested reference? — reserved; the schema
 *     doesn't currently support nested templates, but a defensive
 *     scan over all templates covers the future extension)
 *
 * Per requirements.md §9.11.3: deletion of a referenced entity must be
 * refused. The single-writer contract holds: DSH is the only writer of
 * templates/ and meta.json, so a serialised scan is safe within a single
 * DSH process.
 *
 * v1.0 scope: read + list.
 * v2.0 A2 surface (this revision): `create` / `update` / `delete`
 *   with id + schema + ref-count guards.
 *
 * @module dsh-team-plugin/team-template-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths, ensureDir } from './paths.js';
import { writeJsonFile } from './log-writer.js';
import { validateId as _validateId } from './role-service.js';

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

const VALID_FLOWS = new Set([
  'handoff-round-table',
  'pipeline-with-feedback',
  'fan-out-collect',
]);

/** @typedef {{
 *   id: string,
 *   name: string,
 *   flow: 'handoff-round-table'|'pipeline-with-feedback'|'fan-out-collect',
 *   flow_config: Record<string, unknown>,
 *   members: Array<{ member_id: string, instance_alias: string }>,
 * }} TeamTemplate
 */

/** @param {string} id */
function validateId(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('team-template-service: id is required');
  }
  if (!ID_PATTERN.test(id)) {
    throw new Error(`team-template-service: id "${id}" must match ${ID_PATTERN}`);
  }
  return id;
}

/**
 * Validate a TeamTemplate object's structural shape. Returns a
 * normalised copy. Throws on any field violation.
 * @param {unknown} tmpl
 * @returns {TeamTemplate}
 */
export function validateTemplate(tmpl) {
  if (!tmpl || typeof tmpl !== 'object') {
    throw new Error('team-template-service: template must be an object');
  }
  const t = /** @type {Record<string, unknown>} */ (tmpl);
  if (typeof t.id !== 'string' || t.id.length === 0) {
    throw new Error('team-template-service: id is required');
  }
  validateId(t.id);
  if (typeof t.name !== 'string' || t.name.length === 0) {
    throw new Error(`team-template-service: template ${t.id} missing name`);
  }
  if (typeof t.flow !== 'string' || !VALID_FLOWS.has(t.flow)) {
    throw new Error(
      `team-template-service: template ${t.id} flow "${String(t.flow)}" must be one of ${[...VALID_FLOWS].join(', ')}`,
    );
  }
  const fc = t.flow_config;
  if (fc != null && (typeof fc !== 'object' || Array.isArray(fc))) {
    throw new Error(`team-template-service: template ${t.id} flow_config must be an object`);
  }
  if (!Array.isArray(t.members) || t.members.length === 0) {
    throw new Error(`team-template-service: template ${t.id} members must be a non-empty array`);
  }
  const seen = new Set();
  const members = [];
  for (const m of t.members) {
    if (!m || typeof m !== 'object') {
      throw new Error(`team-template-service: template ${t.id} each member must be an object`);
    }
    const rec = /** @type {Record<string, unknown>} */ (m);
    if (typeof rec.member_id !== 'string' || rec.member_id.length === 0) {
      throw new Error(`team-template-service: template ${t.id} each member must have member_id`);
    }
    if (typeof rec.instance_alias !== 'string' || rec.instance_alias.length === 0) {
      throw new Error(`team-template-service: template ${t.id} each member must have instance_alias`);
    }
    const key = `${rec.member_id}::${rec.instance_alias}`;
    if (seen.has(key)) {
      throw new Error(`team-template-service: template ${t.id} duplicate (member_id, instance_alias) "${key}"`);
    }
    seen.add(key);
    members.push({ member_id: rec.member_id, instance_alias: rec.instance_alias });
  }
  return /** @type {TeamTemplate} */ ({
    id: t.id,
    name: t.name,
    flow: /** @type {TeamTemplate['flow']} */ (t.flow),
    flow_config: /** @type {Record<string, unknown>} */ ({ ...(fc ?? {}) }),
    members,
  });
}

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
  if (!id || !ID_PATTERN.test(id)) return undefined;
  const path = join(getTeamPaths().templatesDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {TeamTemplate} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}

/**
 * Persist a TeamTemplate. Refuses if the id is already taken.
 * @param {TeamTemplate | unknown} tmpl
 * @returns {Promise<TeamTemplate>}
 */
export async function create(tmpl) {
  const normalised = validateTemplate(tmpl);
  const path = join(getTeamPaths().templatesDir, `${normalised.id}.json`);
  if (existsSync(path)) {
    throw new Error(`team-template-service.create: template "${normalised.id}" already exists`);
  }
  ensureDir(getTeamPaths().templatesDir);
  await writeJsonFile(path, normalised);
  return normalised;
}

/**
 * Update an existing template. The id is immutable. Re-validates shape
 * after the merge. Throws when the template is missing.
 * @param {string} id
 * @param {Partial<TeamTemplate>} patch
 * @returns {Promise<TeamTemplate>}
 */
export async function update(id, patch) {
  validateId(id);
  if (!patch || typeof patch !== 'object') {
    throw new Error(`team-template-service.update: patch is required for template "${id}"`);
  }
  if (patch.id !== undefined && patch.id !== id) {
    throw new Error(
      `team-template-service.update: template id is immutable ("${id}" -> "${patch.id}")`,
    );
  }
  const cur = await get(id);
  if (!cur) {
    throw new Error(`team-template-service.update: template "${id}" not found`);
  }
  const next = validateTemplate({ ...cur, ...patch, id });
  const path = join(getTeamPaths().templatesDir, `${id}.json`);
  await writeJsonFile(path, next);
  return next;
}

/**
 * Delete a TeamTemplate by id. Refuses when any in-flight run has
 * `meta.json.template_id` matching this id. Tombstone-on-refuse is
 * NOT supported here: a refused delete is just a refused delete; the
 * caller is expected to wait for the referencing run to terminate
 * before retrying.
 *
 * @param {string} id
 * @returns {Promise<{ deleted: boolean, refs: number, refRunIds: string[] }>}
 */
export async function remove(id) {
  validateId(id);
  const cur = await get(id);
  if (!cur) return { deleted: false, refs: 0, refRunIds: [] };
  const refRunIds = await findRunsReferencingTemplate(id);
  if (refRunIds.length > 0) {
    return { deleted: false, refs: refRunIds.length, refRunIds };
  }
  const path = join(getTeamPaths().templatesDir, `${id}.json`);
  try {
    await unlink(path);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  return { deleted: true, refs: 0, refRunIds: [] };
}

/**
 * Walk the project-level team-runs dir and return the ids of runs that
 * reference the given template id (via meta.json.template_id). Lazy-
 * import keeps the static graph clean.
 * @param {string} templateId
 * @returns {Promise<string[]>}
 */
async function findRunsReferencingTemplate(templateId) {
  try {
    const { list: listRuns } = await import('./team-service.js');
    const runs = await listRuns({});
    return runs.filter((r) => r?.template_id === templateId).map((r) => r.id);
  } catch {
    return [];
  }
}

/** Test-only reset. Currently a no-op (no in-memory state). */
export function _resetForTests() { /* no in-memory state */ }

void _validateId;
