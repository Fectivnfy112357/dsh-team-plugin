# Deprecated — see `ui/sample-data.js`

The 12 JSON files in this directory were the first attempt at build-time
embedding for the team-config form (30th commit). They were superseded
by `ui/sample-data.js`, a single JS module that exports the same
arrays (`SAMPLE_ROLES` / `SAMPLE_MEMBERS` / `SAMPLE_TEMPLATES`).

Why the rewrite: Node's `node --check` (run by `scripts/verify.mjs`)
requires `import { ... } from './foo.json' assert { type: 'json' }`
on JSON imports, which forces every developer to learn ESM-with-assertions
just to look at the data. A plain JS module sidesteps that and is also
easier to extend with computed fields / fallbacks later.

The JSON files in this directory are no longer imported and are kept
only as a snapshot of what the on-disk shape looks like (so a reader
can compare against `services/{role,member,team-template}-service.js#validate*`).

To delete: `Remove-Item -Recurse -Force ui/sample-data/` (currently
blocked by a workspace safety policy; do it manually once the next
verify pass lands).
