// Validates every `defineTool`-style tool def in lib/tools/team-tools.js
// has an output schema that dsh-tools' AJV validator will accept.
//
// What dsh-tools checks at boot (see cordis-plugin-loader + dsh-tools
// assertSupportedJsonSchema): schema.required must list names that are
// also present in schema.properties. Our verify.mjs smoke test only
// covers service-layer behavior, so it never exercises the tool
// registration path — these structural mistakes slip through and only
// surface when the host actually tries to register the tools at boot.
//
// What this script checks (per tool):
//   1. `output` exists, and has `schema` + `render`.
//   2. If `schema.required` is set, every name in it must appear in
//      `schema.properties`.
//   3. If `schema.properties` is set, it must be nested inside `schema`
//      (not a sibling of `schema` at the `output` object level).
//
// Uses a balanced-brace scanner so one-liner and multi-line output
// blocks are both handled.

import fs from 'node:fs';
import path from 'node:path';

const f = path.join(process.cwd(), 'lib/tools/team-tools.js');
const src = fs.readFileSync(f, 'utf8');

// Find every tool definition: `{ name: 'team.X', ... }` at indentation 2.
const toolStart = /^\s*\{\s*\n\s*name:\s*'([^']+)'/gm;
const tools = [];
let m;
while ((m = toolStart.exec(src))) {
  tools.push({ name: m[1], offset: m.index });
}

// Walk balanced braces from each tool's start to find the tool's closing
// `}` (at the same indentation as the opening `{`).
function findToolBlock(src, start) {
  // Find first `{` from start
  const open = src.indexOf('{', start);
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { open, close: i, body: src.slice(open + 1, i) };
    } else if (c === "'" || c === '"' || c === '`') {
      // skip string literal
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && src[i + 1] === '/') {
      // line comment
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      // block comment
      i += 2;
      while (i < src.length - 1 && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    }
    i++;
  }
  return null;
}

// Within a tool body, extract the `output: { ... }` block using a
// balanced-brace scan starting from the `output:` key.
function extractOutputBlock(toolBody) {
  const key = toolBody.indexOf('output:');
  if (key === -1) return null;
  const brace = toolBody.indexOf('{', key);
  if (brace === -1) return null;
  let depth = 0;
  let i = brace;
  while (i < toolBody.length) {
    const c = toolBody[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return toolBody.slice(brace + 1, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < toolBody.length && toolBody[i] !== quote) {
        if (toolBody[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && toolBody[i + 1] === '/') {
      while (i < toolBody.length && toolBody[i] !== '\n') i++;
    } else if (c === '/' && toolBody[i + 1] === '*') {
      i += 2;
      while (i < toolBody.length - 1 && !(toolBody[i] === '*' && toolBody[i + 1] === '/')) i++;
      i++;
    }
    i++;
  }
  return null;
}

// Within the output block, extract a balanced-brace object starting at
// `start` (which should point at `{`). Returns the inner contents.
function extractBalancedObject(text, start) {
  if (text[start] !== '{') return null;
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return text.slice(start + 1, i);
    } else if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      i++;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i++;
        i++;
      }
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    }
    i++;
  }
  return null;
}

// Get keys of a flat object literal like `{ a: ..., b: ... }` — only
// the top-level keys, no nested traversal.
function topLevelKeys(objText) {
  const keys = [];
  let i = 0;
  while (i < objText.length) {
    // skip whitespace
    while (i < objText.length && /\s/.test(objText[i])) i++;
    if (i >= objText.length) break;
    // skip comments
    if (objText[i] === '/' && objText[i + 1] === '/') {
      while (i < objText.length && objText[i] !== '\n') i++;
      continue;
    }
    if (objText[i] === '/' && objText[i + 1] === '*') {
      i += 2;
      while (i < objText.length - 1 && !(objText[i] === '*' && objText[i + 1] === '/')) i++;
      i++;
      continue;
    }
    // key: either an identifier or a quoted string
    let key;
    if (objText[i] === "'" || objText[i] === '"' || objText[i] === '`') {
      const q = objText[i];
      i++;
      const start = i;
      while (i < objText.length && objText[i] !== q) {
        if (objText[i] === '\\') i++;
        i++;
      }
      key = objText.slice(start, i);
      i++; // skip closing quote
    } else {
      const start = i;
      while (i < objText.length && /[A-Za-z0-9_$]/.test(objText[i])) i++;
      key = objText.slice(start, i);
    }
    if (!key) break;
    keys.push(key);
    // skip until the next top-level key or end
    // we are at the char right after the key; expect optional ws then ':'
    while (i < objText.length && /\s/.test(objText[i])) i++;
    if (objText[i] !== ':') break;
    i++; // skip ':'
    // skip the value: a balanced expression (counting parens, braces, brackets,
    // and skipping strings)
    let depth = 0;
    while (i < objText.length) {
      const c = objText[i];
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        if (depth === 0) break; // end of object
        depth--;
      } else if (c === "'" || c === '"' || c === '`') {
        const q = c;
        i++;
        while (i < objText.length && objText[i] !== q) {
          if (objText[i] === '\\') i++;
          i++;
        }
      } else if (c === ',' && depth === 0) {
        i++;
        break;
      } else if (c === '/' && objText[i + 1] === '/') {
        while (i < objText.length && objText[i] !== '\n') i++;
      } else if (c === '/' && objText[i + 1] === '*') {
        i += 2;
        while (i < objText.length - 1 && !(objText[i] === '*' && objText[i + 1] === '/')) i++;
        i++;
      }
      i++;
    }
  }
  return keys;
}

// Find the top-level keys of a nested object literal by searching for
// `properties: {` at the top level of the given text. Returns the
// top-level keys of that object, or null if not found.
function findPropertiesTopLevelKeys(text) {
  // Find a `properties:` key at the start of a top-level entry.
  // We search for the pattern "properties" possibly followed by ws then
  // ":".
  const keyRe = /(^|,|\{)\s*properties\s*:/g;
  let m;
  while ((m = keyRe.exec(text))) {
    const start = m.index + m[0].length;
    // skip ws
    let i = start;
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text[i] !== '{') continue;
    // extract balanced object
    const objText = extractBalancedObject(text, i);
    if (objText === null) continue;
    return topLevelKeys(objText);
  }
  return null;
}

let errors = 0;
const checked = [];

for (const t of tools) {
  const block = findToolBlock(src, t.offset);
  if (!block) continue;
  const outBlock = extractOutputBlock(block.body);
  if (!outBlock) continue; // tools without `output:` (unlikely)
  // Top-level keys of `output: { ... }`
  const outKeys = topLevelKeys(outBlock);
  if (!outKeys.includes('schema') || !outKeys.includes('render')) {
    // missing render is a different dsh-tools error; let boot catch it
    continue;
  }
  // Extract the `schema: { ... }` value (skip 'schema' then ':' then ws to find '{')
  const schemaKeyIdx = outBlock.indexOf('schema:');
  if (schemaKeyIdx === -1) continue;
  let i = schemaKeyIdx + 'schema:'.length;
  while (i < outBlock.length && /\s/.test(outBlock[i])) i++;
  if (outBlock[i] !== '{') continue;
  const schemaBody = extractBalancedObject(outBlock, i);
  if (schemaBody === null) continue;
  const schemaKeys = topLevelKeys(schemaBody);
  const hasRequired = schemaKeys.includes('required');
  const hasPropsInSchema = schemaKeys.includes('properties');
  // Also check if `output` block has a sibling `properties` (BUG case)
  const hasPropsAsSibling = outKeys.includes('properties');
  checked.push({
    name: t.name,
    hasRequired,
    hasPropsInSchema,
    hasPropsAsSibling,
  });
  if (hasPropsAsSibling && !hasPropsInSchema) {
    console.log(`FAIL  ${t.name}: output.properties is a SIBLING of output.schema (must be nested in schema)`);
    errors++;
    continue;
  }
  if (!hasRequired) continue;
  // required: ['a', 'b'] — extract names
  const reqKeyIdx = schemaBody.indexOf('required:');
  if (reqKeyIdx === -1) continue;
  let j = reqKeyIdx + 'required:'.length;
  while (j < schemaBody.length && /\s/.test(schemaBody[j])) j++;
  if (schemaBody[j] !== '[') continue;
  // extract array
  let depth = 0;
  let k = j;
  while (k < schemaBody.length) {
    if (schemaBody[k] === '[') depth++;
    else if (schemaBody[k] === ']') {
      depth--;
      if (depth === 0) break;
    }
    k++;
  }
  const arrText = schemaBody.slice(j + 1, k);
  const reqNames = [];
  const nameRe = /'([^']+)'/g;
  let nm;
  while ((nm = nameRe.exec(arrText))) reqNames.push(nm[1]);
  if (reqNames.length === 0) continue;
  // Get the schema.properties top-level keys
  const propKeys = findPropertiesTopLevelKeys(schemaBody) ?? [];
  for (const r of reqNames) {
    if (!propKeys.includes(r)) {
      console.log(`FAIL  ${t.name}: required "${r}" not in schema.properties`);
      errors++;
    }
  }
}

if (errors === 0) {
  console.log(`OK  checked ${checked.length} tool output blocks, all schema.required keys are present in schema.properties`);
  process.exit(0);
} else {
  console.log(`\n${errors} failure(s) across ${checked.length} tool output blocks`);
  process.exit(1);
}
