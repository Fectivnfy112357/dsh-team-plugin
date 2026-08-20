#!/usr/bin/env node
/**
 * test-install.mjs — end-to-end test: "does dsh-team-plugin break DSH
 * startup once it's installed into a profile?"
 *
 * Companion to verify.mjs (which is read-only / doesn't spawn dsh).
 * This script:
 *
 *   [1/4] prerequisites
 *     - dsh is on PATH (via `where.exe dsh`)
 *     - the junction path the user installed from exists
 *     - lib/index.js has no 'slots' in `inject:` (the host-side footgun
 *       from MEMORY: web profile is host, slots is client-only; including
 *       'slots' makes the host fail with "pending (waiting for service: slots)")
 *
 *   [2/4] manifest
 *     - `dsh --profile <p> --dump-config` shows `dsh-team-plugin-skill`
 *     - the three subagent-acp providers from cordis.patch.yml are
 *       registered (hermes / mcode / claude-code)
 *
 *   [3/4] host boot
 *     - spawn `dsh --profile <p> --port 0`, wait up to 12s
 *     - stdout must contain `dsh web: http://127.0.0.1:<port>`
 *     - stderr must NOT match the fatal patterns from MEMORY
 *       (UNSUPPORTED_SCHEMA / failed to apply loader entry /
 *       ERR_MODULE_NOT_FOUND / plugin tree failed to load)
 *     - HTTP HEAD / on the port returns 2xx/3xx/4xx (the server is
 *       actually listening, not just printed the URL and crashed)
 *
 *   [4/4] teardown
 *     - SIGTERM the spawned host, wait for it to exit
 *
 * Exit code: 0 on all-pass, 1 on any-fail. Each check prints OK/FAIL.
 *
 * Usage:
 *   node scripts/test-install.mjs                              # web profile, default junction
 *   node scripts/test-install.mjs web "D:\dsh-plugins\dsh-agent-team"
 *   node scripts/test-install.mjs tui "D:\dsh-plugins\dsh-team"
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const profile = process.argv[2] ?? 'web';
const junctionPath = process.argv[3] ?? 'D:\\dsh-plugins\\dsh-agent-team';
const bootTimeoutMs = (Number(process.argv[4]) || 12) * 1000;
const isWindows = process.platform === 'win32';

const checks = [];
const ok = (msg) => { checks.push({ ok: true, msg }); console.log('  \u2713 ' + msg); };
const fail = (msg) => { checks.push({ ok: false, msg }); console.error('  \u2717 ' + msg); };

// Resolve the repo root (this script lives in scripts/, so .. is the root)
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

console.log(`test-install: profile=${profile} junction=${junctionPath}\n`);

// ---- 1. prerequisites ----
console.log('[1/4] prerequisites');

function findDsh() {
  if (isWindows) {
    const r = spawnSync('where.exe', ['dsh'], { encoding: 'utf8' });
    if (r.status === 0) {
      const lines = r.stdout.split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const base = line.trim().replace(/^"|"$/g, '');
        // `where.exe dsh` on PowerShell-shimmed installs (npm global)
        // returns the path WITHOUT the .ps1 extension, e.g.
        // `...\node_global\dsh` even though the actual file is
        // `dsh.ps1`. Prefer the .ps1/.cmd/.bat sibling if any exist;
        // fall back to the no-ext path only if no extension matches.
        const hasExt = /\.[^\\/]+$/.test(base);
        const candidates = [];
        if (!hasExt) {
          for (const ext of ['.ps1', '.cmd', '.bat', '.exe']) {
            candidates.push(base + ext);
          }
          candidates.push(base);
        } else {
          candidates.push(base);
        }
        for (const p of candidates) {
          if (existsSync(p)) {
            const kind = p.toLowerCase().endsWith('.ps1') ? 'ps1'
              : p.toLowerCase().endsWith('.cmd') ? 'cmd'
              : p.toLowerCase().endsWith('.bat') ? 'bat'
              : 'exe';
            return { path: p, kind };
          }
        }
      }
    }
  } else {
    const r = spawnSync('which', ['dsh'], { encoding: 'utf8' });
    if (r.status === 0) {
      const p = r.stdout.trim();
      if (existsSync(p)) return { path: p, kind: 'exe' };
    }
  }
  return null;
}

const dsh = findDsh();
if (!dsh) fail('dsh not on PATH (run `where.exe dsh` to confirm)');
else ok(`dsh found: ${dsh.path} (.${dsh.kind})`);

if (dsh) {
  const ver = spawnSync(
    dsh.kind === 'ps1' ? 'pwsh' : dsh.path,
    dsh.kind === 'ps1'
      ? ['-NoProfile', '-NonInteractive', '-Command', `& '${dsh.path}' --version`]
      : ['--version'],
    { encoding: 'utf8' }
  );
  const v = (ver.stdout || ver.stderr || '').trim().split('\n').pop();
  v ? ok(`dsh ${v}`) : fail('dsh --version returned empty');
}

if (!existsSync(junctionPath)) fail(`junction path not found: ${junctionPath}`);
else ok(`junction path exists: ${junctionPath}`);

// Static check: lib/index.js must NOT include 'slots' in inject: list
// (the host-side footgun: web is host, slots is client-only).
const libPath = fileURLToPath(new URL('../lib/index.js', import.meta.url));
if (existsSync(libPath)) {
  const libText = readFileSync(libPath, 'utf8');
  const injectMatch = libText.match(/export\s+const\s+inject\s*=\s*\[([^\]]*)\]/);
  if (!injectMatch) {
    ok('lib/index.js has no `inject` field (host-safe by default)');
  } else {
    const items = injectMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    if (items.includes('slots')) {
      fail(`lib/index.js inject includes 'slots': [${items.join(', ')}] — web profile is host, slots is client-only. Will fail boot with "pending (waiting for service: slots)"`);
    } else {
      ok(`lib/index.js inject: [${items.join(', ')}] (no 'slots', host-safe)`);
    }
  }
}

// ---- 2. manifest ----
console.log('\n[2/4] profile manifest');

function runDsh(args) {
  if (!dsh) return { status: -1, stdout: '', stderr: 'dsh not resolved' };
  if (dsh.kind === 'ps1') {
    return spawnSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-File', dsh.path, ...args],
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 }
    );
  }
  return spawnSync(dsh.path, args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
}

let dumpText = '';
if (dsh) {
  const dump = runDsh(['--profile', profile, '--dump-config']);
  dumpText = (dump.stdout || '') + (dump.stderr || '');
  if (dump.status !== 0) {
    fail(`dsh --profile ${profile} --dump-config failed (exit ${dump.status})`);
  } else {
    if (/dsh-team-plugin-skill/.test(dumpText)) {
      ok(`dsh-team-plugin-skill present in profile manifest`);
    } else {
      fail(`dsh-team-plugin-skill NOT in profile manifest. Run: dsh plugin --profile ${profile} add ${junctionPath}`);
    }
    for (const id of ['subagent-acp-hermes', 'subagent-acp-mcode', 'subagent-acp-claude-code']) {
      if (dumpText.includes(id)) ok(`provider ${id} registered`);
      else fail(`provider ${id} missing (cordis.patch.yml lists it; check patch is applied)`);
    }
  }
}

// ---- 3. host boot ----
console.log('\n[3/4] host boot');

// Each DSH profile has a different "ready" signal. web prints
// `dsh web: http://127.0.0.1:<port>`; headless prints a session id;
// tui starts an interactive TTY. We only know how to verify web
// (the profile this plugin targets), so any other profile is a
// semantic mismatch — fail early instead of spawning a process
// with arguments the headless/tui profile won't accept.
if (profile !== 'web') {
  fail(`profile='${profile}' is not 'web' — this plugin is web-only (the Team panel needs a web UI). Skip test-install for other profiles.`);
} else if (dsh) {
  // Spawn dsh web, capture stdout+stderr, race against timeout
  const args = ['--profile', profile, '--port', '0'];
  const child = dsh.kind === 'ps1'
    ? spawn('pwsh', ['-NoProfile', '-NonInteractive', '-File', dsh.path, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(dsh.path, args, { stdio: ['ignore', 'pipe', 'pipe'] });

  const outChunks = [];
  const errChunks = [];
  child.stdout.on('data', (b) => outChunks.push(b));
  child.stderr.on('data', (b) => errChunks.push(b));

  const race = await Promise.race([
    new Promise((r) => child.once('exit', (code, signal) => r({ kind: 'exit', code, signal }))),
    new Promise((r) => setTimeout(() => r({ kind: 'timeout' }), bootTimeoutMs)),
  ]);

  const outText = Buffer.concat(outChunks).toString('utf8');
  const errText = Buffer.concat(errChunks).toString('utf8');

  if (race.kind === 'exit') {
    if (race.code === 0) {
      fail(`host exited cleanly with code 0 BEFORE producing a server URL — plugin is not actually starting a server. stdout: ${outText.slice(-300)} stderr: ${errText.slice(-300)}`);
    } else {
      fail(`host exited early with code ${race.code} (signal=${race.signal ?? 'none'})\nstdout: ${outText.slice(-500)}\nstderr: ${errText.slice(-500)}`);
    }
  } else {
    // timeout = still running, expected
    const urlMatch = outText.match(/dsh web:\s*http:\/\/127\.0\.0\.1:(\d+)/);
    if (!urlMatch) {
      fail(`boot did not produce a server URL within ${bootTimeoutMs / 1000}s\nstdout: ${outText.slice(-500)}\nstderr: ${errText.slice(-500)}`);
    } else {
      const port = urlMatch[1];
      ok(`host listening on http://127.0.0.1:${port}`);

      // HTTP probe: just confirm something is serving
      const probe = await new Promise((resolve) => {
        const req = http.request(
          { host: '127.0.0.1', port: Number(port), path: '/', method: 'GET', timeout: 3000 },
          (res) => {
            res.resume();
            resolve({ status: res.statusCode });
          }
        );
        req.on('error', (e) => resolve({ error: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
        req.end();
      });
      if (probe.error) fail(`HTTP probe on / failed: ${probe.error}`);
      else ok(`HTTP probe on / returned ${probe.status} (server is responding)`);
    }

    // Stderr fatal-pattern check (MEMORY: the dsh-tools AJV validator
    // surfaces as UNSUPPORTED_SCHEMA; the loader surfaces as
    // "failed to apply loader entry" / "plugin tree failed to load";
    // missing dep surfaces as ERR_MODULE_NOT_FOUND)
    const fatalPatterns = [
      { re: /UNSUPPORTED_SCHEMA/i, label: 'UNSUPPORTED_SCHEMA (dsh-tools AJV rejection)' },
      { re: /failed to apply loader entry/i, label: 'failed to apply loader entry (Cordis)' },
      { re: /plugin tree failed to load/i, label: 'plugin tree failed to load (Cordis)' },
      { re: /Cannot find package/i, label: 'Cannot find package (missing dep)' },
      { re: /ERR_MODULE_NOT_FOUND/, label: 'ERR_MODULE_NOT_FOUND (missing dep)' },
      { re: /waiting for service: slots/i, label: 'waiting for service: slots (inject footgun)' },
    ];
    const hits = fatalPatterns.filter((p) => p.re.test(errText));
    if (hits.length > 0) {
      fail(`stderr contains fatal pattern(s):\n      ${hits.map((h) => h.label).join('\n      ')}\n      --- stderr ---\n      ${errText.trim().split('\n').slice(0, 8).join('\n      ')}`);
    } else if (errText.trim().length > 0) {
      ok(`stderr has non-fatal content (${errText.trim().split('\n').length} line(s)) — not a hard failure`);
    } else {
      ok('stderr empty (clean boot)');
    }
  }

  // ---- 4. teardown ----
  console.log('\n[4/4] teardown');

  // Use taskkill on Windows to kill the whole tree (child processes);
  // on POSIX, SIGTERM the leader. We give the leader 1.5s to exit,
  // then force-kill if still alive.
  if (isWindows) {
    const tk = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { encoding: 'utf8' });
    if (tk.status === 0) ok(`taskkill /T /F pid=${child.pid} ok`);
    else fail(`taskkill failed: ${tk.stderr || tk.stdout}`);
  } else {
    try { child.kill('SIGTERM'); ok(`SIGTERM sent to pid=${child.pid}`); }
    catch (e) { fail(`kill failed: ${e.message}`); }
  }
  // Wait for exit
  const exitRace = await Promise.race([
    new Promise((r) => child.once('exit', (code) => r({ exited: true, code }))),
    new Promise((r) => setTimeout(() => r({ exited: false }), 2000)),
  ]);
  if (exitRace.exited) ok(`host exited (code=${exitRace.code})`);
  else warn('host did not exit within 2s after kill (may be lingering)');
}

function warn(msg) { console.warn('  ! ' + msg); }

const passed = checks.filter((c) => c.ok).length;
const failed = checks.length - passed;
console.log(`\n${passed} passed, ${failed} failed (${checks.length} total)`);
process.exit(failed === 0 ? 0 : 1);
