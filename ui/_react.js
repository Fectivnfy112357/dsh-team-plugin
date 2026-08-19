/**
 * _react.js — React.createElement shim for static plugin UI.
 *
 * Per dsh-dual-plugin-guide (core-api.md §1): Cordis plugins are loaded
 * into a non-transpilation context, so JSX is unavailable. Use
 * `createElement(...)` directly. The DSH host provides React globally
 * (`globalThis.React`); if it's not present (unit test, isolated load)
 * we return a sentinel object so the caller can identify the case.
 *
 * This shim is intentionally tiny — it's a dependency-free way to keep
 * the UI files readable (`import { createElement as h } from './_react.js'`)
 * without every component re-deriving the React resolution.
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
  return {
    __reactEl: true,
    type,
    props: finalProps,
    children: childArray,
  };
}
