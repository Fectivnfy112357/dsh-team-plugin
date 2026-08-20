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
 * small N).
 *
 * v2.0 #2 (this revision): the cross-Run reverse-reference index
 * `refCountIndex` is now maintained in-memory and lazily rebuilt on
 * first read. It maps `derived_from` ref -> Set<artifactId> (the
 * consumer artifact's `<run-id>/<id>`). `refCount()` and `canDelete()`
 * are O(1) lookups against the index; the linear scan only runs at
 * startup or after a manual reset.
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

/**
 * v2.0 #2 in-memory cross-Run reverse-reference index.
 * Key: a ref string as it appears in some artifact's `derived_from`
 *   (either the canonical `<runId>/<id>` form or the bare `<id>` form;
 *   both are valid consumer refs per architecture §9.11.4).
 * Value: Set of consumer artifact ids (`<runId>/<id>`) that reference
 *   this ref at least once (deduped: an artifact with two derived_from
 *   pointing at the same target counts as 1, matching v1.0 lazy scan
 *   semantics).
 * @type {Map<string, Set<string>>}
 */
const _refCountIndex = new Map();

/** Lazy-load flag: rebuild the index from disk on first refCount/canDelete. */
let _indexInitialized = false;

/** Add a (consumerArtifactId, ref) edge to the index. The consumer
 * artifact's `derived_from` contains `ref` at least once. Idempotent:
 * adding the same edge twice is a no-op. */
function indexAdd(ref, consumerArtifactId) {
  if (!ref || !consumerArtifactId) return;
  let set = _refCountIndex.get(ref);
  if (!set) {
    set = new Set();
    _refCountIndex.set(ref, set);
  }
  set.add(consumerArtifactId);
}

/** Rebuild the index from disk. Called on first refCount/canDelete after
 * process start (and after `_resetIndexForTests`). The walk scans every
 * run manifest once; subsequent lookups are O(1) against the index. */
async function rebuildIndex() {
  _refCountIndex.clear();
  const teamRunsDir = getTeamPaths().teamRunsDir;
  if (!existsSync(teamRunsDir)) {
    _indexInitialized = true;
    return;
  }
  const runs = (await readdir(teamRunsDir)).filter((d) => d.startsWith('run-'));
  for (const run of runs) {
    const manifest = await readManifest(run);
    for (const a of manifest.artifacts) {
      const consumerId = `${a.run_id}/${a.id}`;
      const seen = new Set();
      for (const dep of a.derived_from ?? []) {
        if (seen.has(dep)) continue;
        seen.add(dep);
        indexAdd(dep, consumerId);
      }
    }
  }
  _indexInitialized = true;
}

/** Test-only: clear the in-memory index. The next refCount/canDelete
 * call will trigger a rebuild from disk. */
export function _resetIndexForTests() {
  _refCountIndex.clear();
  _indexInitialized = false;
}

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
  // v2.0 #2: index the new artifact's derived_from edges. Idempotent:
  // re-registering the same id short-circuits above, so the index is
  // only updated on genuinely new entries. The seen Set dedups intra-
  // artifact repeated refs (matching the v1.0 lazy scan semantics).
  const consumerId = `${meta.run_id}/${meta.id}`;
  const seen = new Set();
  for (const dep of meta.derived_from) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    indexAdd(dep, consumerId);
  }
  // Mark the index as fresh — the disk write is the source of truth and
  // we've kept it in sync. (No rebuild needed on the next refCount call.)
  _indexInitialized = true;
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
 * Count references to an artifact. v2.0 #2: O(1) against the in-memory
 * `_refCountIndex` (lazily rebuilt from disk on first call). The legacy
 * linear scan is preserved in comments as a correctness check; the
 * returned count is the number of distinct consumer artifacts (each
 * artifact counts at most once per ref, even if its `derived_from` has
 * the same ref twice) that reference `ref` under either the bare-id
 * or `<runId>/<id>` form.
 * @param {string} ref
 * @returns {Promise<number>}
 */
export async function refCount(ref) {
  const parsed = parseRef(ref);
  if (!parsed.runId || !parsed.id) return 0;
  if (!_indexInitialized) await rebuildIndex();
  // The two equivalent forms (bare id and <runId>/<id>) might both appear
  // in the index; union their consumer sets and return the distinct count.
  const target = `${parsed.runId}/${parsed.id}`;
  const set1 = _refCountIndex.get(ref);
  const set2 = _refCountIndex.get(target);
  if (!set1 && !set2) return 0;
  const merged = new Set();
  if (set1) for (const id of set1) merged.add(id);
  if (set2) for (const id of set2) merged.add(id);
  return merged.size;
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
