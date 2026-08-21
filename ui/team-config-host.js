/**
 * team-config-host.js — settings.section 槽位的 DSH 端 component 适配层。
 *
 * 30th commit — **build-time embed for testing**. The DSH client has no
 * generic `host.call(method, args)` dispatcher and no `team.*` typed RPC
 * (`packages/host/apiproxy/src/api/rpc-map.ts:24-77` has 53 typed methods
 * with no `team.*` slot; `WEB_SETTINGS_NAMESPACES` at `api-proxy.ts:126-128`
 * is a hard-coded allowlist that we can't extend from a plugin). The
 * host-side `team.*` Cordis tools write JSON into
 * `<DSH_HOME>/team-assets/{roles,members,team-templates}/`, but the
 * browser-side `TeamConfigPanel` has no way to read those files.
 *
 * For a working form to test against, this revision embeds the data at
 * build time: `ui/sample-data.js` exports 4 roles + 5 members + 3
 * templates as plain JS objects. esbuild inlines them into
 * `lib/client.js` via static `import`, so no extra fetch happens. We
 * picked a JS module over per-file JSON imports because Node's
 * `node --check` (run by `scripts/verify.mjs`) requires
 * `assert { type: 'json' }` on JSON imports, which would force every
 * developer to learn ESM-with-assertions just to look at the data.
 *
 * 31st commit — **wire submit/delete callbacks**. The HOC was passing
 * only the data arrays, leaving the form's `onSubmitRole` etc.
 * undefined. That cascaded to a default browser form submission on
 * click, which re-loaded the page (the user-reported bug). The fix
 * here ships `onSubmitRole` / `onSubmitMember` / `onSubmitTemplate` /
 * `onDelete` that log to the console so the user sees the click
 * actually triggered something.
 *
 * 32nd commit — **stateful list**. The user reported "click 保存 but
 * no echo on the page". The 31st-commit fix was meant to surface a
 * "✓ 已保存 HH:MM:SS" line under the form, but the user couldn't see
 * it (DSH/React 18 + custom createElement shim interaction is finicky
 * for `useState` inside an unhosted slot entry). We take the more
 * useful path: turn the HOC into a stateful component that OWNS the
 * roles/members/templates arrays via `useState`, so the form's submit
 * callback appends the new entity to the array, the list re-renders
 * with the new row, and the user sees their input show up in the
 * panel — same feedback, more reliable. The console-log call stays
 * for parity with the 31st-commit behavior.
 *
 * 33rd commit — **localStorage persistence**. The 32nd-commit state
 * lived only in the in-memory HOC, so a page refresh wiped every
 * newly-created role / member / template. We now read the three
 * arrays from `localStorage` on mount (falling back to the
 * `SAMPLE_*` defaults when nothing is stored) and write the current
 * state back through a `useEffect` after every mutation. This makes
 * changes survive across browser refreshes. **Scope is per-origin +
 * per-browser**: cross-device or cross-profile sharing still needs
 * §4 (settingsScope / typed RPC) — see the data layer note below.
 *
 * When §4 lands, replace the `useState` initial values with reads
 * from a `settingsScope` snapshot (or a typed RPC call) and replace
 * the `useEffect` localStorage writes with the host tool calls
 * (e.g. `team.create_role(payload).then(mergeIntoLocalSnapshot)`).
 * The render path stays identical.
 *
 * 29th commit already owns `activeTab` state inside `TeamConfigPanel`
 * via `React.useState`; the HOC keeps the same pattern.
 *
 * @module dsh-team-plugin/ui/team-config-host
 */

import { createElement as h } from './_react.js';
import { TeamConfigPanel } from './team-config.js';
import { SAMPLE_ROLES, SAMPLE_MEMBERS, SAMPLE_TEMPLATES } from './sample-data.js';

/**
 * Console-log prefix so the user can distinguish our submit events
 * from DSH / React / host noise in devtools.
 */
const PREFIX = '[dsh-team-plugin]';

/**
 * localStorage key prefix. Three separate keys so a corrupted
 * payload in one (say, the user manually edited the JSON) doesn't
 * take down the others.
 */
const LS = {
  roles: 'dsh-team-plugin:config:roles',
  members: 'dsh-team-plugin:config:members',
  templates: 'dsh-team-plugin:config:templates',
};

/**
 * Read an array from localStorage. Returns `fallback` when:
 *   - `localStorage` is unavailable (private browsing in some browsers,
 *     file:// origin, server-side render)
 *   - the slot is empty
 *   - the payload doesn't parse as JSON
 *   - the parsed value isn't an array
 *   - any element fails the bare-minimum shape check (id is a non-empty
 *     string). Bad rows are dropped, the survivors are returned; if
 *     all rows are bad, the fallback wins.
 *
 * @param {string} key
 * @param {any[]} fallback
 * @returns {any[]}
 */
function readLS(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem?.(key);
    if (typeof raw !== 'string' || raw.length === 0) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const ok = parsed.filter((x) => x && typeof x === 'object' && typeof x.id === 'string' && x.id.length > 0);
    return ok.length > 0 || parsed.length === 0 ? ok : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write an array to localStorage. Silent on failure (quota, private
 * mode, file://): the form still works in-memory, the persistence is
 * just lost. We never throw out of a useEffect.
 * @param {string} key
 * @param {any[]} value
 */
function writeLS(key, value) {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(value));
  } catch {
    /* ignore — quota / private mode / file:// */
  }
}

/**
 * DSH-side component to register on `settings.section`. Stateful: owns
 * the live `roles` / `members` / `templates` arrays, persists them to
 * `localStorage`, and mutates them on submit/delete so the form's
 * create / delete actions show up immediately in the panel and
 * survive a browser refresh.
 *
 * When the §4 data layer lands, swap the `useState` initial values
 * for `settingsScope.bind({ namespace: 'dsh-team-plugin' }).getSnapshot()`
 * reads and swap the `useEffect` localStorage writes for
 * `team.create_role(payload).then(mergeIntoLocalSnapshot)` host tool
 * calls. The render path stays identical.
 *
 * @param {object} _props - DSH runtime props (`close`, `t`, `useXxx` from
 *   inject face). Currently ignored.
 * @returns {any} the TeamConfigPanel vdom.
 */
export function TeamConfigPanelHost(_props) {
  const React = (typeof globalThis !== 'undefined' && globalThis.React) || undefined;
  const useState = React && typeof React.useState === 'function' ? React.useState : null;
  const useEffect = React && typeof React.useEffect === 'function' ? React.useEffect : null;

  // useState / useEffect may be null in environments where React didn't
  // load; the fallback uses the input array as-is and skips the effect.
  const initialRoles = useState ? useState(readLS(LS.roles, SAMPLE_ROLES)) : [SAMPLE_ROLES, () => {}];
  const initialMembers = useState ? useState(readLS(LS.members, SAMPLE_MEMBERS)) : [SAMPLE_MEMBERS, () => {}];
  const initialTemplates = useState ? useState(readLS(LS.templates, SAMPLE_TEMPLATES)) : [SAMPLE_TEMPLATES, () => {}];
  const [roles, setRoles] = initialRoles;
  const [members, setMembers] = initialMembers;
  const [templates, setTemplates] = initialTemplates;

  // Persist on every mutation. The effect runs after the render
  // commits, so localStorage always reflects the latest committed
  // state. Both useEffect and the setters are best-effort: a failure
  // in either direction only loses persistence, not the in-memory
  // state for the current session.
  if (useEffect) {
    useEffect(() => { writeLS(LS.roles, roles); }, [roles]);
    useEffect(() => { writeLS(LS.members, members); }, [members]);
    useEffect(() => { writeLS(LS.templates, templates); }, [templates]);
  }

  return h(TeamConfigPanel, {
    roles,
    members,
    templates,
    onSubmitRole: (payload) => {
      try { console.log(PREFIX, 'role form submit:', payload); } catch { /* ignore */ }
      if (payload && typeof payload.id === 'string' && payload.id.length > 0) {
        setRoles((prev) => {
          if (prev.some((r) => r && r.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    },
    onSubmitMember: (payload) => {
      try { console.log(PREFIX, 'member form submit:', payload); } catch { /* ignore */ }
      if (payload && typeof payload.id === 'string' && payload.id.length > 0) {
        setMembers((prev) => {
          if (prev.some((m) => m && m.id === payload.id)) return prev;
          // Cross-ref check: the member's role_id must point at an
          // existing role. Mirror the host-side `validateMember` rule
          // (services/member-service.js) so we don't render a
          // dangling reference. NOTE: `roles` is captured at the
          // closure level — a stale read is fine here because the
          // user can re-submit after a role is created.
          if (typeof payload.role_id !== 'string' || !roles.some((r) => r && r.id === payload.role_id)) {
            try { console.warn(PREFIX, 'member form submit: role_id', JSON.stringify(payload.role_id), 'not in roles, ignoring'); } catch { /* ignore */ }
            return prev;
          }
          return [...prev, payload];
        });
      }
    },
    onSubmitTemplate: (payload) => {
      try { console.log(PREFIX, 'template form submit:', payload); } catch { /* ignore */ }
      if (payload && typeof payload.id === 'string' && payload.id.length > 0) {
        setTemplates((prev) => {
          if (prev.some((t) => t && t.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    },
    onDelete: (kind, id) => {
      try { console.log(PREFIX, 'delete', kind, 'id=' + id); } catch { /* ignore */ }
      if (kind === 'role') {
        setRoles((prev) => prev.filter((r) => r && r.id !== id));
      } else if (kind === 'member') {
        setMembers((prev) => prev.filter((m) => m && m.id !== id));
      } else if (kind === 'template') {
        setTemplates((prev) => prev.filter((t) => t && t.id !== id));
      }
    },
  });
}
