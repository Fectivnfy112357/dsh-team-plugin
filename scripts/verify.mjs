#!/usr/bin/env node
/**
 * verify.mjs \u2014 dsh-team-plugin dual-format + code integrity self-check.
 *
 * Layers:
 *   1. Critical paths (dual-format 5 + services + tools + UI)
 *   2. Identity + SKILL.md frontmatter
 *   3. Syntax: node --check on every .js/.mjs
 *   4. Relative links in lib/ + skills/ + line endings + lib/index.js load
 *   5. Smoke test: services end-to-end against a temp directory
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(process.argv[2] ?? process.cwd());
const failures = [];
const warnings = [];
const ok = (msg) => console.log('  \u2713 ' + msg);
const warn = (msg) => { warnings.push(msg); console.warn('  ! ' + msg); };
const fail = (msg) => { failures.push(msg); console.error('  \u2717 ' + msg); };

let pkg, plg, name;
try {
  pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  plg = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8'));
  name = pkg.name;
} catch (error) {
  console.error('error: cannot read package.json/plugin.json at ' + root + ': ' + error.message);
  process.exit(1);
}
console.log('\u9a8c\u8bc1\u5305\uff1a' + name + ' @ ' + root + '\n');

// ---- 1. critical paths ----
console.log('[1/5] critical paths');
for (const f of ['package.json', 'plugin.json', 'cordis.patch.yml', 'lib/index.js']) {
  existsSync(join(root, f)) ? ok(f) : fail('missing: ' + f);
}
const skillsDir = join(root, 'skills');
if (existsSync(skillsDir)) {
  const subs = readdirSync(skillsDir).filter((e) => statSync(join(skillsDir, e)).isDirectory());
  if (subs.length === 0) fail('skills/ is empty');
  for (const sub of subs) {
    const sf = join('skills', sub, 'SKILL.md');
    existsSync(join(root, sf)) ? ok(sf) : fail('missing: ' + sf);
  }
} else fail('skills/ directory missing');
for (const sub of ['services', 'ui']) {
  const d = join(root, sub);
  if (existsSync(d)) {
    const fs = readdirSync(d).filter((f) => f.endsWith('.js'));
    if (fs.length === 0) warn(sub + '/ is empty (P1+ will fill this)'); for (const f of fs.filter((f) => f.endsWith('.jsx'))) ok(sub + '/' + f);
    for (const f of fs) ok(sub + '/' + f);
  } else fail(sub + '/ directory missing');
}
const libToolsDir = join(root, 'lib', 'tools');
if (existsSync(libToolsDir)) {
  for (const f of readdirSync(libToolsDir).filter((f) => f.endsWith('.js') || f.endsWith('.jsx'))) {
    ok('lib/tools/' + f);
  }
}

// ---- 2. identity + frontmatter ----
console.log('\n[2/5] identity + frontmatter');
if (plg.name === pkg.name) ok('plugin.json.name == package.json.name ("' + name + '")');
else fail('plugin.json.name ("' + plg.name + '") != package.json.name ("' + pkg.name + '")');

const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
NAME_RE.test(name) ? ok('package name matches Agent Plugins 1.0 rules') : fail('package name "' + name + '" violates name rules');

pkg.dsh?.bundle?.patch ? ok('dsh.bundle.patch = ' + pkg.dsh.bundle.patch) : fail('package.json missing dsh.bundle.patch');

Array.isArray(pkg.files) && pkg.files.includes('lib') && pkg.files.includes('skills')
  ? ok('package.json files includes lib + skills')
  : fail('package.json files must include lib and skills');

if (existsSync(skillsDir)) {
  for (const sub of readdirSync(skillsDir)) {
    const subPath = join(skillsDir, sub);
    if (!statSync(subPath).isDirectory()) continue;
    const sf = join(subPath, 'SKILL.md');
    if (!existsSync(sf)) continue;
    const text = readFileSync(sf, 'utf8');
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      /^name:/m.test(fm[1]) ? ok('skills/' + sub + '/SKILL.md frontmatter has name') : fail('skills/' + sub + '/SKILL.md frontmatter missing name');
      /^description:/m.test(fm[1]) ? ok('skills/' + sub + '/SKILL.md frontmatter has description') : fail('skills/' + sub + '/SKILL.md frontmatter missing description');
    } else {
      fail('skills/' + sub + '/SKILL.md missing YAML frontmatter');
    }
    if (text.startsWith('---\r\n')) {
      fail('skills/' + sub + '/SKILL.md has CRLF line endings (validator expects LF)');
    }
  }
}

// ---- 3. syntax ----
console.log('\n[3/5] syntax (node --check)');
function checkJsDir(dir, prefix) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      checkJsDir(p, prefix + entry + '/');
    } else if (entry.endsWith('.js') || entry.endsWith('.mjs') || entry.endsWith('.jsx')) {
      const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
      if (r.status === 0) ok(prefix + entry);
      else fail(prefix + entry + ': ' + r.stderr.trim().split('\n').pop());
    }
  }
}
checkJsDir(join(root, 'lib'), 'lib/');
checkJsDir(join(root, 'services'), 'services/');
checkJsDir(join(root, 'ui'), 'ui/');
checkJsDir(join(root, 'scripts'), 'scripts/');

// ---- 4. links + line endings + lib/index.js load ----
console.log('\n[4/5] relative links + line endings + lib/index.js load');
const pluginOutputDirs = ['lib', 'skills'];
const mdFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.git')) continue;
      walk(p);
    } else if (entry.endsWith('.md') && pluginOutputDirs.some((d) => p.includes('\\' + d + '\\') || p.includes('/' + d + '/'))) {
      mdFiles.push(p);
    }
  }
})(root);
let links = 0;
let checkedFiles = 0;
for (const f of mdFiles) {
  checkedFiles++;
  const text = readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|#|\/)/.test(target)) continue;
    links++;
    const resolved = resolve(dirname(f), target.split('#')[0]);
    if (!existsSync(resolved)) fail(relative(root, f) + ': broken link -> ' + target);
  }
}
ok(checkedFiles + ' files, ' + links + ' relative links checked');

for (const f of ['package.json', 'plugin.json', 'cordis.patch.yml']) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  const data = readFileSync(p, 'utf8');
  const crlfCount = (data.match(/\r\n/g) || []).length;
  if (crlfCount > 0) warn(f + ' contains ' + crlfCount + ' CRLF line(s)');
  else ok(f + ' uses LF line endings');
}

try {
  const libPath = join(root, 'lib', 'index.js');
  if (existsSync(libPath)) {
    await import('file://' + libPath.replaceAll('\\', '/'));
    ok('lib/index.js loads without syntax errors');
  }
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    warn('lib/index.js load test skipped (cordis / ctx unavailable outside DSH runtime): ' + error.message.split('\n')[0]);
  } else {
    fail('lib/index.js failed to load: ' + error.message);
  }
}

// Tool output schema structural validity — dsh-tools' AJV validator runs
// at host boot, not at lib load, so smoke tests never catch a stray
// `properties` sibling of `schema` or a `required` name not present in
// `properties`. See scripts/check-output-schema.mjs.
const schemaCheck = spawnSync(process.execPath, [join(root, 'scripts', 'check-output-schema.mjs')], { encoding: 'utf8' });
if (schemaCheck.status === 0) {
  const m = schemaCheck.stdout.match(/OK\s+checked\s+(\d+)\s+tool\s+output\s+blocks/);
  ok(`tool output schemas valid (${m ? m[1] : '?'} blocks)`);
} else {
  fail('tool output schema check failed:\n' + schemaCheck.stdout + '\n' + schemaCheck.stderr);
}

// ---- 5. smoke test ----
console.log('\n[5/5] smoke test (services end-to-end)');
const smoke = spawnSync(process.execPath, [join(root, 'scripts', 'smoke-test.mjs')], { encoding: 'utf8' });
if (smoke.status === 0) {
  const passed = (smoke.stdout.match(/\u2713/g) || []).length;
  ok('smoke-test passed (' + passed + ' checks)');
} else {
  fail('smoke-test failed:\n' + smoke.stdout + '\n' + smoke.stderr);
}

console.log('');
if (failures.length === 0) {
  console.log('\u2705 verify passed (' + warnings.length + ' warnings, ' + failures.length + ' errors)');
  process.exit(0);
} else {
  console.error('\u274c ' + failures.length + ' errors, ' + warnings.length + ' warnings');
  process.exit(1);
}
