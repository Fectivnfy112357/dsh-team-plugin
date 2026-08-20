#!/usr/bin/env node
/**
 * transform-tool-params.mjs — one-shot transformer that rewrites every
 * `parameters:` block in `lib/tools/team-tools.js` from the
 * **JSON-Schema envelope** shape to the **property-map** shape that
 * `@deepseek-ai/dsh-tools#defineTool` expects.
 *
 * Background:
 *   dsh-tools' `defineTool` calls `parameterSchemaSpecToJsonSchema` on
 *   `options.parameters`. That function expects a *property map*
 *   (top-level keys are property names, each value is the per-property
 *   schema with `required?: true` on the property itself). The
 *   author-facing wrapper for the `object` case is added internally;
 *   passing the wrapper is a type error and dsh-tools throws
 *   `UNSUPPORTED_SCHEMA: parameters.type must be a value schema
 *   object` on host boot.
 *
 *   This transformer is a recovery from the original (wrong) format
 *   the team-plugin shipped in. It rewrites:
 *
 *     parameters: {
 *       type: 'object',
 *       required: ['taskDescription', 'flow', 'members'],
 *       additionalProperties: false,
 *       properties: {
 *         taskDescription: { type: 'string', description: '...' },
 *         flow: { type: 'string', enum: [...] },
 *         ...
 *       }
 *     }
 *
 *   into:
 *
 *     parameters: {
 *       taskDescription: { type: 'string', required: true, description: '...' },
 *       flow: { type: 'string', required: true, enum: [...] },
 *       ...
 *     }
 *
 * Idempotent: re-running on already-transformed code is a no-op
 * (no `type: 'object'` envelope to find, every entry already
 * has its own `required: true` where needed).
 *
 * @module dsh-team-plugin/scripts/transform-tool-params
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = fileURLToPath(new URL('../lib/tools/team-tools.js', import.meta.url));
const src = readFileSync(TARGET, 'utf8');

/**
 * Find the index of the matching `}` for an opening `{` at `openIdx`.
 * Tracks string and template-literal boundaries so braces inside
 * string values don't fool the depth counter. The tool file is plain
 * ES2022 JS — no regex literals contain `{` or `}` that would be
 * problematic for the counter, but handling strings keeps it honest.
 * @param {string} s
 * @param {number} openIdx
 * @returns {number}
 */
function matchingBrace(s, openIdx) {
  let depth = 0;
  let i = openIdx;
  let quote = null;
  while (i < s.length) {
    const c = s[i];
    if (quote !== null) {
      if (c === '\\') { i += 2; continue; }
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
    } else if (c === '{') {
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  throw new Error('transform-tool-params: unmatched brace at ' + openIdx);
}

/**
 * Re-emit an object literal as JS source with the same indent style
 * the file already uses. `level` is the **tab-unit** indent (one
 * step per nesting level); the caller converts from the line's
 * character column to tab units so this function doesn't need to
 * know whether the file uses spaces or tabs.
 * @param {Record<string, any>} obj
 * @param {number} level — tab-unit indent for the opening `{`
 * @param {string} tab
 * @returns {string}
 */
function emitObject(obj, level, tab) {
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const lines = [];
  for (const k of keys) {
    const v = obj[k];
    const scalar = isScalar(v);
    const valStr = emitValue(v, level + 1, tab, scalar);
    const keyStr = /^[a-zA-Z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
    if (valStr.includes('\n')) {
      // Value spans multiple lines: key on the entry line, value
      // body indented under it. The value's own closing `}` line
      // carries a trailing comma so the next key (if any) is
      // syntactically separated (Node 24 rejects `} <ident>` in
      // object literals even with a newline between).
      const vLines = valStr.split('\n');
      vLines[vLines.length - 1] = vLines[vLines.length - 1] + ',';
      lines.push(tab.repeat(level + 1) + keyStr + ': ' + vLines[0]);
      for (let i = 1; i < vLines.length; i++) lines.push(vLines[i]);
    } else {
      lines.push(tab.repeat(level + 1) + keyStr + ': ' + valStr + ',');
    }
  }
  return '{\n' + lines.join('\n') + '\n' + tab.repeat(level) + '}';
}

/**
 * True for primitives that fit on a single line (`null`, `boolean`,
 * `number`, short `string`).
 * @param {any} v
 */
function isScalar(v) {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'boolean' || t === 'number') return true;
  if (t === 'string') return true;
  return false;
}

/**
 * Re-emit a value as a JS expression. Strings get single quotes
 * (with internal `'` escaped to `\\'`); numbers/booleans/null pass
 * through; arrays/objects recurse. `inline=true` requests the
 * value to fit on a single line (used for scalar fields inside an
 * object literal so the whole key/value pair stays on one row).
 * @param {any} v
 * @param {number} level — tab-unit indent for any line breaks
 * @param {string} tab
 * @param {boolean} [inline] — prefer single-line emission
 * @returns {string}
 */
function emitValue(v, level, tab, inline = false) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return String(v);
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (inline) {
      return '[' + v.map((it) => emitValue(it, level + 1, tab, true)).join(', ') + ']';
    }
    const items = v.map((it) => tab.repeat(level + 1) + emitValue(it, level + 1, tab, false) + ',');
    return '[\n' + items.join('\n') + '\n' + tab.repeat(level) + ']';
  }
  if (typeof v === 'object') {
    return emitObject(v, level, tab);
  }
  throw new Error('transform-tool-params: unsupported value ' + typeof v);
}

/**
 * Convert a character column to a tab-unit level. The tab unit is
 * inferred from the file's indent string (tab char or 2-space).
 * @param {string} linePrefix — the part of the line up to the
 *   column we want to anchor (typically up to the `{`)
 * @param {string} tab
 * @returns {number}
 */
function levelOf(linePrefix, tab) {
  const m = linePrefix.match(/^(\s*)/);
  const charCol = m ? m[1].length : 0;
  const tabWidth = tab.length;
  return Math.floor(charCol / tabWidth);
}

/**
 * Parse the JS text of a `parameters` value (the contents of the
 * outermost `{ ... }` block, including braces). Uses `new Function`
 * to evaluate the literal in an isolated scope so we don't pollute
 * globals; returns the parsed object. This is safe because the input
 * is the plugin's own source file.
 * @param {string} blockText
 * @returns {Record<string, any>}
 */
function parseBlock(blockText) {
  // Wrap in parens to force expression context. The block is a
  // top-level `{ ... }` object literal.
  return new Function('return (' + blockText + ');')();
}

let out = '';
let cursor = 0;
let transforms = 0;

while (cursor < src.length) {
  const idx = src.indexOf('parameters:', cursor);
  if (idx === -1) break;
  // The colon must be followed by `{` (optionally with a newline + indent in between).
  const after = idx + 'parameters:'.length;
  const braceStart = src.indexOf('{', after);
  if (braceStart === -1) {
    out += src.substring(cursor);
    break;
  }
  let braceEnd;
  try {
    braceEnd = matchingBrace(src, braceStart);
  } catch (error) {
    out += src.substring(cursor);
    break;
  }
  const blockText = src.substring(braceStart, braceEnd + 1);
  const parsed = parseBlock(blockText);
  if (
    parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    parsed.type === 'object' && parsed.properties
  ) {
    // The JSON-Schema envelope — convert to property map.
    const required = new Set(Array.isArray(parsed.required) ? parsed.required : []);
    const next = {};
    for (const [k, v] of Object.entries(parsed.properties)) {
      next[k] = { ...v };
      if (required.has(k)) next[k].required = true;
    }
    // Use the same indent as the line the original `parameters:` was
    // on. Find the line prefix (whitespace up to the `{`), infer the
    // tab character, and convert the character column to a tab-unit
    // level so emitObject produces a consistent column.
    const lineStart = src.lastIndexOf('\n', braceStart) + 1;
    const linePrefix = src.substring(lineStart, braceStart);
    const indentMatch = linePrefix.match(/^(\s*)/);
    const tabChar = (indentMatch && indentMatch[1].includes('\t')) ? '\t' : '  ';
    const level = levelOf(linePrefix, tabChar);
    const newBlock = emitObject(next, level, tabChar);
    out += src.substring(cursor, braceStart) + newBlock;
    cursor = braceEnd + 1;
    transforms++;
  } else {
    // Not an envelope — leave untouched.
    out += src.substring(cursor, braceStart);
    cursor = braceStart;
  }
}
out += src.substring(cursor);

if (transforms === 0) {
  console.log('transform-tool-params: no JSON-Schema envelopes found (already transformed?)');
} else {
  writeFileSync(TARGET, out, 'utf8');
  console.log('transform-tool-params: rewrote ' + transforms + ' parameters block(s) in lib/tools/team-tools.js');
}
