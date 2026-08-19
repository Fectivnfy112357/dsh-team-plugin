/**
 * paths.js — data root resolution for dsh-team-plugin.
 *
 * Per architecture.md §5.1:
 *   - roles/ members/ team-templates/   live in the **global** dsh data root
 *   - team-runs/<run-id>/              lives in the **project** root
 *
 * Both are read from the environment when available, otherwise resolved via
 * safe fallbacks. The plugin never assumes a hard-coded absolute path; the
 * DSH host provides the canonical values via env vars or the storage hub
 * (`ctx.storage`), and the plugin listens rather than guessing.
 *
 * @module dsh-team-plugin/paths
 */
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** @typedef {{
 *   dataRoot: string,
 *   projectRoot: string,
 *   globalRoot: string,
 *   teamRunsDir: string,
 *   rolesDir: string,
 *   membersDir: string,
 *   templatesDir: string,
 * }} TeamPaths
 */

/**
 * Best-effort resolver for the dsh host's home directory. The DSH CLI exposes
 * this via the `@deepseek-ai/dsh-home-paths` package; if the package is not
 * installed (e.g. during isolated unit tests of this plugin) we fall back to
 * `process.env.DSH_HOME` and finally to `~/.dsh`.
 * @returns {string} absolute path to the dsh data home.
 */
function resolveDshHome() {
  // 1. explicit env var (always honored; matches DSH CLI convention)
  const env = process.env.DSH_HOME;
  if (env && env.length > 0) return resolve(env);
  // 2. try the official resolver; if it isn't installed, fall through
  try {
    // Dynamic import is fine in ESM; the module is optional.
    const mod = /** @type {any} */ (globalThis);
    if (typeof mod.__dshHomePath === 'function') return mod.__dshHomePath();
  } catch {
    /* ignore */
  }
  // 3. conventional default
  return join(homedir(), '.dsh');
}

/**
 * Best-effort resolver for the active project root. The DSH host may export
 * this via env (e.g. DSH_PROJECT_DIR) or via ctx; we read env first and fall
 * back to the current working directory.
 * @returns {string} absolute path to the project root.
 */
function resolveProjectRoot() {
  const env = process.env.DSH_PROJECT_DIR ?? process.env.DSH_CWD;
  if (env && env.length > 0 && isAbsolute(env)) return env;
  return process.cwd();
}

/**
 * Compute all canonical paths the plugin needs. Pure function — no I/O.
 * @returns {TeamPaths}
 */
export function resolveTeamPaths() {
  const globalRoot = resolveDshHome();
  const projectRoot = resolveProjectRoot();
  return {
    dataRoot: globalRoot,
    projectRoot,
    globalRoot,
    teamRunsDir: join(projectRoot, '.dsh', 'team-runs'),
    rolesDir: join(globalRoot, 'team-assets', 'roles'),
    membersDir: join(globalRoot, 'team-assets', 'members'),
    templatesDir: join(globalRoot, 'team-assets', 'team-templates'),
  };
}

/** Cached paths singleton. The host may change DSH_PROJECT_DIR at runtime, so
 * we re-resolve on every call rather than memoising. */
let _cached = /** @type {TeamPaths | null} */ (null);
/** @returns {TeamPaths} */
export function getTeamPaths() {
  _cached = resolveTeamPaths();
  return _cached;
}

/**
 * Make sure a directory exists. Idempotent. Used by services that lazily
 * create the team-runs tree on first write.
 * @param {string} dir
 */
export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Path of a run directory: `<team-runs>/<run-id>/`.
 * @param {string} runId
 * @returns {string}
 */
export function runDir(runId) {
  return join(getTeamPaths().teamRunsDir, runId);
}

/**
 * Path of a session directory: `<team-runs>/<run-id>/sessions/<member-id>/`.
 * @param {string} runId
 * @param {string} memberId
 * @returns {string}
 */
export function sessionDir(runId, memberId) {
  return join(runDir(runId), 'sessions', memberId);
}
