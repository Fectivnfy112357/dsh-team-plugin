#!/usr/bin/env node
/**
 * strip-unsupported-schema-keys.mjs — global line-level cleaner that
 * removes every JSON-Schema constraint keyword that
 * `@deepseek-ai/dsh-tools#defineTool` rejects at host boot.
 *
 * Strategy: this pass does NOT track block boundaries. It walks the
 * file line by line and drops:
 *   - `minItems: N` / `maxItems: N` / `minimum: N` / `maximum: N` /
 *     `minLength: N` / `maxLength: N` / `pattern: '...'` /
 *     `format: '...'` / `uniqueItems: true|false` lines
 *   - `required: ['a', 'b', ...]` arrays (drop the opening line and any
 *     continuation lines until the matching `]`)
 *
 * The dsh-tools value-schema DSL does not allow any of these keys
 * (in either `parameters` property values or `output.schema`
 * values), so a global drop is the correct shape.
 *
 * The cleaner is line-level and ignores block context, so a `required`
 * inside a string literal (e.g. `'Required: ...'`) is safe — the
 * regex only matches lines whose first non-whitespace token is the
 * banned key followed by `:` / `[`. A `required: true` (boolean, not
 * array) is unaffected because the regex requires `[` after the
 * colon.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = fileURLToPath(new URL('../lib/tools/team-tools.js', import.meta.url));

const KEY_RE = /^(\s+)(minItems|maxItems|minimum|maximum|minLength|maxLength|pattern|format|uniqueItems):/;
const REQUIRED_RE = /^(\s+)required:\s*\[/;

const src = readFileSync(TARGET, 'utf8');
const lines = src.split('\n');
const out = [];
let removed = 0;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (KEY_RE.test(line)) { removed++; continue; }
  if (REQUIRED_RE.test(line)) {
    removed++;
    // Walk forward until the matching `]`. We only count `[` and `]`
    // (skip string contents); a malformed line without a closer
    // would be the original file's bug, not ours to fix here.
    let depth = 1;
    while (i + 1 < lines.length && depth > 0) {
      i++;
      const l = lines[i];
      for (const c of l) {
        if (c === '[') depth++;
        else if (c === ']') { depth--; if (depth === 0) break; }
      }
    }
    continue;
  }
  out.push(line);
}

if (removed === 0) {
  console.log('strip-unsupported-schema-keys: no unsupported keys found (already clean?)');
} else {
  writeFileSync(TARGET, out.join('\n'), 'utf8');
  console.log('strip-unsupported-schema-keys: removed ' + removed + ' line(s)');
}
