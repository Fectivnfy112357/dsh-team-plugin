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
 * Bundle shape — DSH client-modules CJS contract:
 *   The browser peer of this file is loaded as a classic <script>; the
 *   module system (packages/client/modules in dsh) installs
 *   `window.__ModuleLoader__` and expects every bundle to immediately
 *   hand off via `load({ id, factory })`. The factory is called LATER
 *   (lazy materialization) with a sync `require` bound to the module
 *   table; it returns the plugin's `module.exports` (a Cordis plugin
 *   object — `apply` + `inject`).
 *
 *   We wrap the CJS body in:
 *     var module = { exports: {} }; var exports = module.exports;
 *     window.__ModuleLoader__.load({
 *       id: "dsh-team-plugin",
 *       factory: (require) => {
 *         // ...CJS body, all imports inlined, exports = { apply, inject }...
 *         return module.exports;
 *       }
 *     });
 *
 *   This is the same pattern tsdown emits for DSH's first-party client
 *   packages (see packages/client/tsdown.client.ts:269-271).
 *
 * Topology: a single entry point (`src/client.js`) statically imports
 * the five register*Slot functions from `ui/*.js`; those pull in
 * their transitive deps. esbuild walks the graph and emits a single
 * CJS file at `lib/client.js` that the DSH client-modules service
 * serves verbatim.
 *
 * @module dsh-team-plugin/scripts/build-client
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { statSync, readFileSync } from 'node:fs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = 'src/client.js';
const OUT = 'lib/client.js';

// Source of truth for the registration id. Must equal the boot-graph
// row id (== package.json#name); if the package is ever renamed this
// string is the one place to update.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const PLUGIN_ID = pkg.name;
if (typeof PLUGIN_ID !== 'string' || PLUGIN_ID.length === 0) {
  console.error('build-client: package.json#name is missing — cannot stamp the __ModuleLoader__.load id');
  process.exit(1);
}

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'cjs',
  target: 'es2022',
  outfile: OUT,
  platform: 'browser',
  // The UI's only Node-only dep is `services/plan-service.js`, reached
  // via the lazy `await import(...)` inside `ui/team-plan.js#loadPlan`.
  // The browser runtime has no `node:fs` / `node:path` — bundling the
  // service would fail. Marking it external leaves the import as a
  // runtime call; the host's host.call / dynamic-loader never runs
  // here, so the `try/catch` in `loadPlan` returns `undefined` for
  // every browser plan lookup. In CJS form the dynamic import
  // compiles to `Promise.resolve().then(() => require(...))`; the
  // closure's `require` is the loader's module-table resolver, which
  // doesn't know this path and throws — caught by the try/catch.
  external: ['../services/*'],
  // No minification: the file is ~40KB raw and we want readable
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
  // CJS → classic-script body that hands off via __ModuleLoader__.load.
  // The factory's `require` parameter shadows any global and reaches
  // the loader's module table; the body writes to `module.exports`
  // (the CJS exports object) and the factory returns it. esbuild has
  // no `intro` knob, so the module.exports setup goes in the banner.
  banner: {
    js: [
      'var module = { exports: {} };',
      'var exports = module.exports;',
      `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    ].join('\n'),
  },
  footer: { js: 'return module.exports; } });' },
});

if (result.errors.length > 0) {
  for (const e of result.errors) console.error(e);
  process.exit(1);
}
const size = statSync(OUT).size;
console.log('build-client: wrote ' + OUT + ' (' + size + ' bytes)');
