/**
 * _react.js — React.createElement shim + 视觉 token 系统 (B1).
 *
 * Per dsh-dual-plugin-guide (core-api.md §1): Cordis plugins are loaded
 * into a non-transpilation context, so JSX is unavailable. Use
 * `createElement(...)` directly. The DSH host provides React globally
 * (`globalThis.React`); if it's not present (unit test, isolated load)
 * we return a sentinel object so the caller can identify the case.
 *
 * This module also hosts the **visual token system** (B1, 2.0 #1
 * backlog). The `tokens` constant is the single source of truth for
 * colour, spacing, radius, font and timing. All other `ui/*.js`
 * components MUST source their visual style from `tokens` rather than
 * hard-coding hex codes / pixel values. The shape is small enough to
 * audit at a glance and rich enough to be a real design contract.
 *
 * The DSH host can override the active theme at runtime by setting
 * `globalThis.__dshTeamPluginTheme` to a partial token object; the
 * `tokens` getter merges the override on top of the default. The
 * default theme is "Linear" (a clean, dense, monochrome + accent
 * look) — the same vibe as `mockups/panel-linear.html`.
 *
 * @module dsh-team-plugin/ui/_react
 */

/** @returns {((type: any, props?: any, ...children: any[]) => any)} */
export function createElement(type, props, ...children) {
  const React = /** @type {any} */ (globalThis).React;
  if (React && typeof React.createElement === 'function') {
    return React.createElement(type, props, ...children);
  }
  // Fallback for unit tests / non-React runtimes: return a JSON-serialisable
  // sentinel so the verify script can prove the component was invoked with
  // the right shape. Mirror the real React.createElement contract: the
  // children are available on BOTH `props.children` (single or array) and
  // a top-level `children` array, so callers can use either path.
  const childArray = children.length > 0 ? children : (props?.children != null ? [props.children] : []);
  const finalProps = { ...(props ?? {}) };
  if (children.length > 0) finalProps.children = children.length === 1 ? children[0] : children;
  const el = {
    __reactEl: true,
    type,
    props: finalProps,
    children: childArray,
  };
  // Functional components: invoke the function with the props so the
  // returned sentinel is the **rendered** element, not the component
  // reference. Real React does this in the reconciler; our shim does
  // it eagerly so tree walks (and snapshot tests) can introspect the
  // full output. A component that returns `null` or a primitive is
  // wrapped into a sentinel too.
  if (typeof type === 'function') {
    const rendered = type(finalProps);
    if (rendered === null || rendered === undefined || typeof rendered !== 'object') {
      return { __reactEl: true, type: '$$null', props: {}, children: [], __rendered: rendered };
    }
    return rendered;
  }
  return el;
}

/**
 * Default visual token set ("Linear" theme). Frozen so callers cannot
 * mutate it accidentally; runtime overrides are merged into a fresh
 * object via `tokens` (the getter below).
 *
 * Schema (token categories):
 *   - color: text, surface, border, accent, danger, warning, success,
 *     muted, intent, state (state machine pill backgrounds)
 *   - space: numeric scale (xs / sm / md / lg / xl)
 *   - radius: numeric scale
 *   - font: family + size scale
 *   - motion: durations for state transitions
 */
const DEFAULT_TOKENS = deepFreeze({
  color: {
    text: '#111827',
    muted: '#6b7280',
    surface: '#ffffff',
    surfaceAlt: '#fafafa',
    surfaceMuted: '#f3f4f6',
    border: '#e5e7eb',
    accent: '#3b82f6',
    accentSoft: '#dbeafe',
    danger: '#ef4444',
    dangerSoft: '#fee2e2',
    warning: '#f59e0b',
    warningSoft: '#fef3c7',
    success: '#22c55e',
    successSoft: '#dcfce7',
    intent: {
      produce: '#3b82f6',
      review: '#eab308',
      collect: '#a855f7',
      synthesize: '#22c55e',
      decide: '#f97316',
    },
    state: {
      pending: '#9ca3af',
      assembling: '#3b82f6',
      running: '#22c55e',
      succeeded: '#10b981',
      failed: '#ef4444',
      interrupted: '#f97316',
      aborted: '#6b7280',
      archived: '#4b5563',
    },
  },
  space: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24 },
  radius: { sm: 3, md: 6, lg: 10, pill: 999 },
  font: {
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    size: { xs: 10, sm: 11, md: 12, lg: 13, xl: 14, xxl: 15 },
    weight: { normal: 400, medium: 500, semibold: 600, bold: 700 },
  },
  motion: { fast: 120, base: 200, slow: 320 },
});

/**
 * Deep-freeze a token object. Object.freeze is shallow; without a
 * recursive pass, callers could mutate `tokens.color.accent` via the
 * proxy and have the change stick. The deep freeze is what gives the
 * tokens their "design contract" semantics.
 * @param {any} obj
 * @returns {any}
 */
function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object' && !Object.isFrozen(v)) deepFreeze(v);
    }
  }
  return obj;
}

/**
 * Test-only override. Tests that need a deterministic theme set
 * `globalThis.__dshTeamPluginTheme` before importing any ui module;
 * production code can leave it undefined to use the default.
 * @returns {typeof DEFAULT_TOKENS}
 */
export function getTokens() {
  /** @type {any} */
  const override = /** @type {any} */ (globalThis).__dshTeamPluginTheme;
  if (!override || typeof override !== 'object') return DEFAULT_TOKENS;
  return /** @type {typeof DEFAULT_TOKENS} */ (deepFreeze({
    color: { ...DEFAULT_TOKENS.color, ...(override.color ?? {}) },
    space: { ...DEFAULT_TOKENS.space, ...(override.space ?? {}) },
    radius: { ...DEFAULT_TOKENS.radius, ...(override.radius ?? {}) },
    font: { ...DEFAULT_TOKENS.font, ...(override.font ?? {}),
      size: { ...DEFAULT_TOKENS.font.size, ...(override.font?.size ?? {}) },
      weight: { ...DEFAULT_TOKENS.font.weight, ...(override.font?.weight ?? {}) },
    },
    motion: { ...DEFAULT_TOKENS.motion, ...(override.motion ?? {}) },
  }));
}

/**
 * Re-export the default tokens as `DEFAULT_TOKENS` (frozen) so callers
 * that need to read the static defaults — e.g. theme validators in
 * tests — can do so without going through the `getTokens()` getter.
 */
export { DEFAULT_TOKENS };

/**
 * Convenience: the `tokens` binding. We re-evaluate on every access
 * (no memoisation) so the host can flip the theme at runtime without
 * restarting the plugin. The cost of one object spread per access is
 * negligible for the volume of style reads in the panel.
 */
export const tokens = new Proxy({}, {
  /** @param {any} _target @param {string} prop */
  get(_target, prop) {
    const t = getTokens();
    return t[/** @type {keyof typeof DEFAULT_TOKENS} */ (prop)];
  },
});

/**
 * Reset the active theme override (test-only). Clears
 * `globalThis.__dshTeamPluginTheme` so subsequent `getTokens()` calls
 * return the default. Mirrors the `_reset*ForTests` pattern in the
 * service modules.
 */
export function _resetThemeForTests() {
  try { delete /** @type {any} */ (globalThis).__dshTeamPluginTheme; } catch { /* ignore */ }
}
