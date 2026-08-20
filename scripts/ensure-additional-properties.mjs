#!/usr/bin/env node
/**
 * ensure-additional-properties.mjs — make every `type: 'object'`
 * value schema in `lib/tools/team-tools.js` explicitly declare
 * `additionalProperties: true`. dsh-tools' value-schema DSL
 * requires the field; absent it, host boot throws
 * `UNSUPPORTED_SCHEMA: schema.additionalProperties must be
 * explicitly true or false` (and the same for nested items and
 * properties).
 *
 * Two shapes to handle:
 *   1. Inline: `{ type: 'object' }` → expand to
 *      `{ type: 'object', additionalProperties: true }`. (We can't
 *      add a new line in the middle of a single-line literal, but
 *      we can keep the literal one-liner and just add the field.)
 *   2. Multi-line: a `type: 'object',` line, possibly followed by
 *      `properties:`, `items:`, etc. but no `additionalProperties:`
 *      — insert `additionalProperties: true,` right after the
 *      `type:` line.
 *
 * Idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = fileURLToPath(new URL('../lib/tools/team-tools.js', import.meta.url));
let src = readFileSync(TARGET, 'utf8');

let changed = 0;

// Pass 1: inline `{ type: 'object' }` → `{ type: 'object', additionalProperties: true }`
// Only match when the object literal is exactly `type: 'object'`
// (whitespace allowed), not when it has additional keys.
const before1 = src;
src = src.replace(/\{\s*type:\s*'object'\s*\}/g, "{ type: 'object', additionalProperties: true }");
if (src !== before1) changed++;

// Pass 2: multi-line `type: 'object',` that does NOT have a sibling
// `additionalProperties:` within the next 4 lines.
const lines = src.split('\n');
const out = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  out.push(line);
  if (!/^\s*type:\s*'object',?\s*$/.test(line)) continue;
  let hasSibling = false;
  for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
    const next = lines[j];
    if (/^\s*additionalProperties:/.test(next)) { hasSibling = true; break; }
    if (/^\s*[}\]]/.test(next)) break;
  }
  if (hasSibling) continue;
  // Insert immediately after the `type: 'object'` line. Trim any
  // trailing comma and re-add it (the original line should already
  // have one, but be defensive).
  if (!line.trimEnd().endsWith(',')) {
    out[out.length - 1] = line.trimEnd() + ',';
  }
  const indent = line.match(/^(\s*)/)[1];
  out.push(indent + 'additionalProperties: true,');
  changed++;
}

const after = out.join('\n');
if (after !== src) changed++;
if (changed === 0) {
  console.log('ensure-additional-properties: every type:object already has additionalProperties');
} else {
  writeFileSync(TARGET, after, 'utf8');
  console.log('ensure-additional-properties: rewrote ' + changed + ' pass(es)');
}
