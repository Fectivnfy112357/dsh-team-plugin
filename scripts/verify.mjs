#!/usr/bin/env node
/**
 * verify.mjs — dsh-team-plugin 双格式产物自检脚本。
 *
 * 与 dsh-dual-plugin-guide 的 verify.mjs 区别：支持**多技能**插件
 * （扫描 skills/<name>/SKILL.md 全部子目录，而不是假定单 skill name == plugin name）。
 * 其余三层沿用：
 *   1. 关键路径存在清单（双格式产物）
 *   2. 身份一致性：plugin.json.name == package.json.name；每个 SKILL.md frontmatter 断言
 *   3. Markdown 相对链接可解析（跳过 http/绝对/锚点）
 *
 * 用法：node scripts/verify.mjs [包根目录]   （默认 = 仓根）
 * 退出码：0 通过，非 0 有失败项。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  console.error(`error: cannot read package.json/plugin.json at ${root}: ${error.message}`);
  process.exit(1);
}
console.log(`\u9a8c\u8bc1\u5305\uff1a${name} @ ${root}\n`);

// ---- 1. \u5173\u952e\u8def\u5f84 ----
console.log('[1/4] \u5173\u952e\u8def\u5f84\uff08\u53cc\u683c\u5f0f\u5951\u7ea6\u4e94\u4ef6\u5957\uff09');
const critical = [
  'package.json', 'plugin.json', 'cordis.patch.yml', 'lib/index.js',
];
for (const f of critical) {
  existsSync(join(root, f)) ? ok(f) : fail(`missing: ${f}`);
}
const skillsDir = join(root, 'skills');
if (existsSync(skillsDir)) {
  const skillSubdirs = readdirSync(skillsDir)
    .filter((entry) => statSync(join(skillsDir, entry)).isDirectory());
  if (skillSubdirs.length === 0) {
    fail('skills/ is empty (need at least one <name>/SKILL.md)');
  } else {
    for (const sub of skillSubdirs) {
      const skillFile = join('skills', sub, 'SKILL.md');
      existsSync(join(root, skillFile))
        ? ok(skillFile)
        : fail(`missing: ${skillFile}`);
    }
  }
} else {
  fail('skills/ directory missing');
}

// ---- 2. \u8eab\u4efd\u4e00\u81f4\u6027 + frontmatter ----
console.log('\n[2/4] \u8eab\u4efd\u4e00\u81f4\u6027 + frontmatter');
if (plg.name === pkg.name) ok(`plugin.json.name == package.json.name ("${name}")`);
else fail(`plugin.json.name ("${plg.name}") != package.json.name ("${pkg.name}")`);

const NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
if (NAME_RE.test(name)) ok(`package name matches Agent Plugins 1.0 rules`);
else fail(`package name "${name}" violates name rules (lowercase, digits, dot/dash, no --/.., no leading/trailing -)`);

if (pkg.dsh?.bundle?.patch) ok(`dsh.bundle.patch = ${pkg.dsh.bundle.patch}`);
else fail('package.json missing dsh.bundle.patch');

if (Array.isArray(pkg.files) && pkg.files.includes('lib') && pkg.files.includes('skills')) {
  ok('package.json files includes lib + skills');
} else {
  fail('package.json files must include lib and skills');
}

if (existsSync(skillsDir)) {
  for (const sub of readdirSync(skillsDir)) {
    const subPath = join(skillsDir, sub);
    if (!statSync(subPath).isDirectory()) continue;
    const skillFile = join(subPath, 'SKILL.md');
    if (!existsSync(skillFile)) continue;
    const skill = readFileSync(skillFile, 'utf8');
    const fm = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      /^name:/m.test(fm[1]) ? ok(`skills/${sub}/SKILL.md frontmatter has name`) : fail(`skills/${sub}/SKILL.md frontmatter missing name`);
      /^description:/m.test(fm[1]) ? ok(`skills/${sub}/SKILL.md frontmatter has description`) : fail(`skills/${sub}/SKILL.md frontmatter missing description`);
    } else {
      fail(`skills/${sub}/SKILL.md missing YAML frontmatter`);
    }
    // line ending check (memory rule: frontmatter should be LF)
    if (skill.startsWith('---\r\n')) {
      fail(`skills/${sub}/SKILL.md has CRLF line endings (validator expects LF)`);
    }
  }
}

// ---- 3. \u76f8\u5bf9\u94fe\u63a5\u89e3\u6790\uff08\u53ea\u68c0\u67e5\u53cc\u683c\u5f0f\u4ea7\u7269\uff1alib/ + skills/\uff09----
console.log('\n[3/4] Markdown \u76f8\u5bf9\u94fe\u63a5\uff08\u53cc\u683c\u5f0f\u4ea7\u7269\uff1alib/ + skills/\uff09');
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
    if (!existsSync(resolved)) {
      fail(`${relative(root, f)}: broken link -> ${target}`);
    }
  }
}
ok(`${checkedFiles} \u4e2a\u6587\u4ef6\uff0c${links} \u4e2a\u76f8\u5bf9\u94fe\u63a5\u5df2\u68c0\u67e5`);

// ---- 4. CRLF/LF + lib/index.js \u53ef\u52a0\u8f7d ----
console.log('\n[4/4] \u8bed\u6cd5\u8f7b\u68c0');
for (const f of ['package.json', 'plugin.json', 'cordis.patch.yml', 'lib/index.js']) {
  const p = join(root, f);
  if (!existsSync(p)) continue;
  const data = readFileSync(p, 'utf8');
  // Count CRLF as a warning, not failure (validator only cares about SKILL.md frontmatter)
  const crlfCount = (data.match(/\r\n/g) || []).length;
  if (crlfCount > 0) {
    warn(`${f} contains ${crlfCount} CRLF line(s) (LF recommended for portability)`);
  } else {
    ok(`${f} uses LF line endings`);
  }
}

// Try loading lib/index.js to catch syntax errors
try {
  const libPath = join(root, 'lib', 'index.js');
  if (existsSync(libPath)) {
    await import('file://' + libPath.replaceAll('\\', '/'));
    ok('lib/index.js loads without syntax errors');
  }
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') {
    warn(`lib/index.js load test skipped (cordis / ctx not available outside DSH runtime): ${error.message.split('\n')[0]}`);
  } else {
    fail(`lib/index.js failed to load: ${error.message}`);
  }
}

console.log('');
if (failures.length === 0) {
  console.log(`\u2705 verify \u901a\u8fc7 (${warnings.length} \u8b66\u544a, ${failures.length} \u9519\u8bef)`);
  process.exit(0);
} else {
  console.error(`\u274c ${failures.length} \u4e2a\u9519\u8bef, ${warnings.length} \u4e2a\u8b66\u544a`);
  process.exit(1);
}
