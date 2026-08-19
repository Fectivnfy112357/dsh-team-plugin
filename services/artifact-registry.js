/**
 * artifact-registry.js — artifact metadata + cross-Run references + delete
 * protection (Story 1-3 + §9.11).
 *
 * Per architecture.md §5.5 + §5.6 + §9.11.3:
 *   - artifact location:
 *       team-runs/<run-id>/sessions/<member-id>/artifacts/<id>.<ext>
 *       (or plans/<id> for plan artifacts — handled by plan-service)
 *   - meta file alongside the artifact (same dir, .meta.json)
 *   - fields: produced_by, produced_in_dispatch, produced_in_session,
 *             derived_from, type, created_at
 *   - cross-Run id format (OQ-3 tentative default): <run-id>/<artifact-id>
 *   - delete protection: refCount + cross-Run reverse refs; refuse
 *     if any reference exists
 *   - immutable snapshot: artifacts are never mutated; rerun -> new id
 *
 * v1.0 simplified: the manifest is per-run (<team-runs>/<run-id>/
 * artifacts-manifest.json). Cross-Run references are resolved lazily by
 * scanning the manifest files of all runs (linear scan, fine for v1.0's
 * small N; 2.0 introduces a real index).
 *
 * @module dsh-team-plugin/artifact-registry
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runDir, getTeamPaths } from './paths.js';
import { writeJsonFile } from './log-writer.js';

/** @typedef {{
 *   id: string,
 *   run_id: string,
 *   member_id?: string,
 *   type: string,
 *   file: string,         // relative to <team-runs>/<run-id>/
 *   produced_by: string,
 *   produced_in_dispatch?: string,
 *   produced_in_session?: string,
 *   derived_from: string[],
 *   created_at: string,
 * }} ArtifactMeta
 */

/** @returns {string} */
function manifestPath(runId) {
  return join(runDir(runId), 'artifacts-manifest.json');
}

/**
 * Read the manifest for a run. Returns { artifacts: ArtifactMeta[] }.
 * @param {string} runId
 */
async function readManifest(runId) {
  const p = manifestPath(runId);
  if (!existsSync(p)) return { artifacts: [] };
  try {
    return JSON.parse(await readFile(p, 'utf-8'));
  } catch {
    return { artifacts: [] };
  }
}

async function writeManifest(runId, manifest) {
  await writeJsonFile(manifestPath(runId), manifest);
}

/**
 * Register a new artifact. Idempotent: re-registering the same id is a
 * no-op (returns the existing entry). v1.0 doesn't overwrite; that's the
 * "immutable snapshot" contract.
 * @param {ArtifactMeta} entry
 * @returns {Promise<ArtifactMeta>}
 */
export async function register(entry) {
  if (!entry?.id) throw new Error('artifact-registry.register: id is required');
  if (!entry?.run_id) throw new Error('artifact-registry.register: run_id is required');
  if (!entry?.type) throw new Error('artifact-registry.register: type is required');
  if (!entry?.file) throw new Error('artifact-registry.register: file is required');
  const manifest = await readManifest(entry.run_id);
  const existing = manifest.artifacts.find((a) => a.id === entry.id);
  if (existing) return existing;
  const meta = {
    id: entry.id,
    run_id: entry.run_id,
    ...(entry.member_id ? { member_id: entry.member_id } : {}),
    type: entry.type,
    file: entry.file,
    produced_by: entry.produced_by,
    ...(entry.produced_in_dispatch ? { produced_in_dispatch: entry.produced_in_dispatch } : {}),
    ...(entry.produced_in_session ? { produced_in_session: entry.produced_in_session } : {}),
    derived_from: entry.derived_from ?? [],
    created_at: entry.created_at ?? new Date().toISOString(),
  };
  manifest.artifacts.push(meta);
  await writeManifest(entry.run_id, manifest);
  return meta;
}

/**
 * Resolve an artifact ref. If the ref is cross-Run (`<run-id>/<id>`),
 * scans that run's manifest. v1.0 scans all run dirs lazily — linear in
 * total artifact count, acceptable for small N.
 * @param {string} ref - either bare id (current run) or `<run-id>/<id>`
 * @returns {Promise<ArtifactMeta | undefined>}
 */
export async function resolve(ref) {
  if (!ref) return undefined;
  const { runId, id } = parseRef(ref);
  if (!runId || !id) return undefined;
  const manifest = await readManifest(runId);
  return manifest.artifacts.find((a) => a.id === id);
}

function parseRef(ref) {
  // Cross-Run: "<run-id>/<artifact-id>"
  const slash = ref.indexOf('/');
  if (slash > 0) {
    const runId = ref.slice(0, slash);
    const id = ref.slice(slash + 1);
    if (/^run-[a-z0-9-]+$/.test(runId) && /^[A-Za-z0-9_.-]+$/.test(id)) {
      return { runId, id };
    }
  }
  return { runId: undefined, id: ref };
}

/** @param {string} id @returns {Promise<ArtifactMeta | undefined>} */
export async function get(id) {
  return resolve(id);
}

/** @param {string} runId */
export async function list(runId) {
  const manifest = await readManifest(runId);
  return manifest.artifacts;
}

/**
 * Count references to an artifact. Counts `derived_from` entries across
 * ALL run manifests (the cross-Run contract). v1.0 lazy linear scan.
 * @param {string} ref
 * @returns {Promise<number>}
 */
export async function refCount(ref) {
  const parsed = parseRef(ref);
  if (!parsed.runId || !parsed.id) return 0;
  // We count refs to <runId>/<id> (the canonical cross-Run form) AND
  // bare id (intra-Run references that don't bother with the runId
  // prefix). Both forms are valid; cross-Run is preferred but the
  // intra-Run form is allowed for symmetry.
  let count = 0;
  const teamRunsDir = getTeamPaths().teamRunsDir;
  if (!existsSync(teamRunsDir)) return 0;
  const runs = (await readdir(teamRunsDir)).filter((d) => d.startsWith('run-'));
  const target = `${parsed.runId}/${parsed.id}`;
  for (const run of runs) {
    const manifest = await readManifest(run);
    for (const a of manifest.artifacts) {
      for (const dep of a.derived_from ?? []) {
        // Count each artifact's match at most once (dedup across the
        // two equivalent forms: bare id and <runId>/<id>).
        if (dep === ref || dep === target) { count += 1; break; }
      }
    }
  }
  return count;
}

/**
 * Check whether an artifact can be safely deleted. Returns true iff no
 * artifact in any run references it (per derived_from).
 * @param {string} ref
 * @returns {Promise<boolean>}
 */
export async function canDelete(ref) {
  return (await refCount(ref)) === 0;
}
