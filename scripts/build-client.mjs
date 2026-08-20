#!/usr/bin/env node
/**
 * build-client.mjs — bundle `src/client.js` + its UI deps into a single
 * self-contained `lib/client.js` that DSH's client-modules node half can
 * serve at `/plugins/<id>/client.js`.
 *
 * Why a build step is required:
 *   The team's UI dep graph is layered (src/client.js -> ui/*.js ->
 *   ui/team-handoff-*.js, ui/_react.js, ...), and DSH's `client-modules`
 *   service only serves ONE artifact per plugin (the path declared in
 *   `exports["./client"]`). A self-contained file means the browser
 *   needs no module loader and no second fetch.
 *
 * Why esbuild:
 *   - Fast (one-shot, ~50ms for our 13-file graph).
 *   - No source-maps required for the shipped artifact; we keep the
 *     source for debugging via the unminified output.
 *   - The first hand-rolled attempt collided on file-local helpers
 *     (`stateColor`, `actionButtonStyle` re-declared across files) —
 *     esbuild scopes each module to its own closure automatically.
 *   - One devDep; `npm install` resolves the Windows binary.
 *
 * Topology: a single entry point (`src/client.js`) statically imports
 * the five register*Slot functions from `ui/*.js`; those pull in
 * their transitive deps. esbuild walks the graph and emits a single
 * ESM file at `lib/client.js` that the DSH cordis-client-runner
 * evaluator can `import()` directly.
 *
 * @module dsh-team-plugin/scripts/build-client
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = 'src/client.js';
const OUT = 'lib/client.js';

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: OUT,
  platform: 'browser',
  // The UI's only Node-only dep is `services/plan-service.js`, reached
  // via the lazy `await import(...)` inside `ui/team-plan.js#loadPlan`.
  // The browser runtime has no `node:fs` / `node:path` — bundling the
  // service would fail. Marking it external leaves the import as a
  // runtime call; the host's host.call / dynamic-loader never runs
  // here, so the `try/catch` in `loadPlan` returns `undefined` for
  // every browser plan lookup. That's the right shape — plan data
  // arrives through the host's React props in the real mount path.
  external: ['../services/*'],
  // No minification: the file is ~80KB raw and we want readable
  // stack traces when a component crashes in the browser console.
  minify: false,
  sourcemap: false,
  // Legal comments are noise in the bundle; strip them.
  legalComments: 'none',
  // Don't write a metafile; we only care about the output bytes.
  metafile: false,
  logLevel: 'silent',
  // Useful error context when the build fails.
  absWorkingDir: REPO_ROOT,
});

if (result.errors.length > 0) {
  for (const e of result.errors) console.error(e);
  process.exit(1);
}
const size = statSync(OUT).size;
console.log('build-client: wrote ' + OUT + ' (' + size + ' bytes)');
