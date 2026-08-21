var module = { exports: {} };
var exports = module.exports;
window.__ModuleLoader__.load({ id: "dsh-team-plugin", factory: (require) => {
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);

// ui/_react.js
function createElement(type, props, ...children) {
  const React = (
    /** @type {any} */
    globalThis.React
  );
  if (React && typeof React.createElement === "function") {
    return React.createElement(type, props, ...children);
  }
  const childArray = children.length > 0 ? children : props?.children != null ? [props.children] : [];
  const finalProps = { ...props ?? {} };
  if (children.length > 0) finalProps.children = children.length === 1 ? children[0] : children;
  const el = {
    __reactEl: true,
    type,
    props: finalProps,
    children: childArray
  };
  if (typeof type === "function") {
    const rendered = type(finalProps);
    if (rendered === null || rendered === void 0 || typeof rendered !== "object") {
      return { __reactEl: true, type: "$$null", props: {}, children: [], __rendered: rendered };
    }
    return rendered;
  }
  return el;
}
var DEFAULT_TOKENS = deepFreeze({
  color: {
    text: "#111827",
    muted: "#6b7280",
    surface: "#ffffff",
    surfaceAlt: "#fafafa",
    surfaceMuted: "#f3f4f6",
    border: "#e5e7eb",
    accent: "#3b82f6",
    accentSoft: "#dbeafe",
    danger: "#ef4444",
    dangerSoft: "#fee2e2",
    warning: "#f59e0b",
    warningSoft: "#fef3c7",
    success: "#22c55e",
    successSoft: "#dcfce7",
    intent: {
      produce: "#3b82f6",
      review: "#eab308",
      collect: "#a855f7",
      synthesize: "#22c55e",
      decide: "#f97316"
    },
    state: {
      pending: "#9ca3af",
      assembling: "#3b82f6",
      running: "#22c55e",
      succeeded: "#10b981",
      failed: "#ef4444",
      interrupted: "#f97316",
      aborted: "#6b7280",
      archived: "#4b5563"
    }
  },
  space: { xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24 },
  radius: { sm: 3, md: 6, lg: 10, pill: 999 },
  font: {
    family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    size: { xs: 10, sm: 11, md: 12, lg: 13, xl: 14, xxl: 15 },
    weight: { normal: 400, medium: 500, semibold: 600, bold: 700 }
  },
  motion: { fast: 120, base: 200, slow: 320 }
});
function deepFreeze(obj) {
  if (obj && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
    }
  }
  return obj;
}
function getTokens() {
  const override = (
    /** @type {any} */
    globalThis.__dshTeamPluginTheme
  );
  if (!override || typeof override !== "object") return DEFAULT_TOKENS;
  return (
    /** @type {typeof DEFAULT_TOKENS} */
    deepFreeze({
      color: { ...DEFAULT_TOKENS.color, ...override.color ?? {} },
      space: { ...DEFAULT_TOKENS.space, ...override.space ?? {} },
      radius: { ...DEFAULT_TOKENS.radius, ...override.radius ?? {} },
      font: {
        ...DEFAULT_TOKENS.font,
        ...override.font ?? {},
        size: { ...DEFAULT_TOKENS.font.size, ...override.font?.size ?? {} },
        weight: { ...DEFAULT_TOKENS.font.weight, ...override.font?.weight ?? {} }
      },
      motion: { ...DEFAULT_TOKENS.motion, ...override.motion ?? {} }
    })
  );
}
var tokens = new Proxy({}, {
  /** @param {any} _target @param {string} prop */
  get(_target, prop) {
    const t = getTokens();
    return t[
      /** @type {keyof typeof DEFAULT_TOKENS} */
      prop
    ];
  }
});

// ui/layout.js
function TeamTopBar(props) {
  const active = props?.activeRun ?? null;
  return createElement(
    "div",
    {
      className: "dsh-team-topbar",
      "data-layout-kind": "top",
      style: {
        display: "flex",
        alignItems: "center",
        gap: tokens.space.md,
        padding: `${tokens.space.md}px ${tokens.space.lg}px`,
        background: tokens.color.surface,
        borderBottom: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.lg,
        color: tokens.color.text
      }
    },
    createElement(
      "div",
      { className: "dsh-team-brand", style: { display: "flex", alignItems: "center", gap: tokens.space.sm } },
      createElement("span", { "data-brand-mark": true, style: { width: 8, height: 8, borderRadius: tokens.radius.pill, background: tokens.color.accent } }),
      createElement("strong", { "data-brand-name": true, style: { fontSize: tokens.font.size.xl, fontWeight: tokens.font.weight.semibold } }, "DSH Team")
    ),
    active ? createElement(
      "div",
      { className: "dsh-team-topbar-active", style: { display: "flex", alignItems: "center", gap: tokens.space.sm, marginLeft: "auto" } },
      createElement("span", { "data-active-run-id": active.id, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, active.id),
      createElement("span", {
        "data-active-state-pill": active.state,
        style: {
          padding: `1px ${tokens.space.md}px`,
          borderRadius: tokens.radius.pill,
          background: stateColor(active.state),
          color: "white",
          fontSize: tokens.font.size.xs,
          fontWeight: tokens.font.weight.semibold,
          textTransform: "uppercase"
        }
      }, active.state),
      active.degraded_flag ? createElement("span", { "data-degraded-pill": true, style: { color: tokens.color.warning, fontSize: tokens.font.size.xs } }, "\u26A0") : null
    ) : createElement("span", { "data-topbar-empty": true, style: { marginLeft: "auto", color: tokens.color.muted, fontSize: tokens.font.size.sm } }, "No active Team Run")
  );
}
function TeamFooter(props) {
  const c = props?.counts ?? {};
  return createElement(
    "div",
    {
      className: "dsh-team-footer",
      "data-layout-kind": "footer",
      style: {
        display: "flex",
        alignItems: "center",
        gap: tokens.space.lg,
        padding: `${tokens.space.sm}px ${tokens.space.lg}px`,
        background: tokens.color.surfaceMuted,
        borderTop: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.xs,
        color: tokens.color.muted
      }
    },
    counter("acp", c.acp ?? 0, "ACP sessions"),
    counter("artifacts", c.artifacts ?? 0, "artifacts"),
    counter("dispatches", c.dispatches ?? 0, "dispatches"),
    counter("messages", c.messages ?? 0, "messages")
  );
}
function counter(name, value, label) {
  return createElement(
    "span",
    {
      "data-counter": name,
      "data-value": String(value),
      style: { display: "inline-flex", alignItems: "baseline", gap: tokens.space.xs }
    },
    createElement("strong", { style: { color: tokens.color.text, fontSize: tokens.font.size.sm, fontWeight: tokens.font.weight.semibold } }, String(value)),
    createElement("span", null, label)
  );
}
function stateColor(state) {
  return tokens.color.state[
    /** @type {keyof typeof tokens.color.state} */
    state
  ] ?? tokens.color.muted;
}
function registerLayoutSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/layout: ctx.slots.inject unavailable; team-topbar / team-footer skipped");
    return;
  }
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "team-topbar",
        order: 50,
        label: "DSH Team Top Bar"
      },
      TeamTopBar
    )
  );
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "team-footer",
        order: 50,
        label: "DSH Team Footer"
      },
      TeamFooter
    )
  );
}

// ui/sidebar.js
var TERMINAL = /* @__PURE__ */ new Set(["succeeded", "failed", "aborted", "interrupted"]);
function stateColor2(r) {
  if (!r) return tokens.color.muted;
  return tokens.color.state[
    /** @type {keyof typeof tokens.color.state} */
    r.state
  ] ?? tokens.color.muted;
}
function renderRunRow(r, selectedRunId, onSelectRun) {
  const isSelected = r.id === selectedRunId;
  return createElement(
    "div",
    {
      key: r.id,
      className: "dsh-team-sidebar-row",
      "data-run-id": r.id,
      "data-state": r.state,
      "data-selected": isSelected ? "true" : "false",
      onClick: onSelectRun ? () => onSelectRun(r.id) : void 0,
      style: {
        display: "flex",
        alignItems: "center",
        gap: tokens.space.sm,
        padding: `${tokens.space.sm}px ${tokens.space.md}px`,
        background: isSelected ? tokens.color.accentSoft : "transparent",
        borderLeft: isSelected ? `3px solid ${tokens.color.accent}` : "3px solid transparent",
        borderRadius: tokens.radius.sm,
        cursor: onSelectRun ? "pointer" : "default",
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
        fontFamily: tokens.font.family
      }
    },
    createElement("span", {
      "data-row-state-pill": r.state,
      style: {
        width: 6,
        height: 6,
        borderRadius: tokens.radius.pill,
        background: stateColor2(r),
        flex: "0 0 auto"
      }
    }),
    createElement(
      "div",
      { style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden" } },
      createElement(
        "div",
        { "data-row-task": true, style: { fontWeight: tokens.font.weight.medium, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } },
        r.task_description?.slice(0, 30) ?? r.id
      ),
      createElement(
        "div",
        { "data-row-meta": true, style: { fontSize: tokens.font.size.xs, color: tokens.color.muted } },
        `${r.flow} \xB7 ${r.id}`
      )
    ),
    r.degraded_flag ? createElement("span", { "data-row-degraded": true, style: { color: tokens.color.warning, fontSize: tokens.font.size.xs } }, "\u26A0") : null
  );
}
function CollapsibleSection(props) {
  const { title, count, defaultOpen = true, children } = props;
  return createElement(
    "div",
    { className: "dsh-team-sidebar-section", "data-section": title.toLowerCase() },
    createElement(
      "div",
      {
        className: "dsh-team-sidebar-section-header",
        "data-section-header": true,
        style: {
          padding: `${tokens.space.sm}px ${tokens.space.md}px`,
          fontSize: tokens.font.size.xs,
          fontWeight: tokens.font.weight.semibold,
          color: tokens.color.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          borderTop: `1px solid ${tokens.color.border}`
        }
      },
      title,
      createElement("span", { "data-section-count": true, style: { marginLeft: tokens.space.xs, color: tokens.color.muted } }, String(count))
    ),
    defaultOpen ? createElement("div", { className: "dsh-team-sidebar-section-body", "data-section-body": true, style: { display: "flex", flexDirection: "column", gap: 2 } }, children) : null
  );
}
function TeamSidebar(props) {
  const active = (props?.activeRuns ?? []).filter((r) => !TERMINAL.has(r.state));
  const historical = (props?.historicalRuns ?? []).filter((r) => TERMINAL.has(r.state));
  const selectedRunId = props?.selectedRunId;
  const onSelectRun = props?.onSelectRun;
  return createElement(
    "div",
    {
      className: "dsh-team-sidebar",
      "data-component": "sidebar",
      style: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.space.sm,
        padding: tokens.space.sm,
        background: tokens.color.surface,
        borderRight: `1px solid ${tokens.color.border}`,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text,
        height: "100%",
        overflow: "auto"
      }
    },
    createElement(
      CollapsibleSection,
      { title: "Active", count: active.length, defaultOpen: true },
      active.length === 0 ? createElement(
        "div",
        { "data-section-empty": "active", style: { color: tokens.color.muted, fontSize: tokens.font.size.sm, padding: `${tokens.space.sm}px ${tokens.space.md}px`, fontStyle: "italic" } },
        "No active Team."
      ) : active.map((r) => renderRunRow(r, selectedRunId, onSelectRun))
    ),
    createElement(
      CollapsibleSection,
      { title: "History", count: historical.length, defaultOpen: false },
      historical.length === 0 ? createElement(
        "div",
        { "data-section-empty": "history", style: { color: tokens.color.muted, fontSize: tokens.font.size.sm, padding: `${tokens.space.sm}px ${tokens.space.md}px`, fontStyle: "italic" } },
        "No history yet."
      ) : historical.map((r) => renderRunRow(r, selectedRunId, onSelectRun))
    ),
    createElement(
      "div",
      {
        className: "dsh-team-sidebar-library",
        "data-section": "library",
        style: {
          marginTop: "auto",
          padding: tokens.space.md,
          borderTop: `1px solid ${tokens.color.border}`
        }
      },
      createElement(
        "a",
        {
          href: props?.libraryHref ?? "#",
          onClick: props?.onOpenLibrary ? (e) => {
            e?.preventDefault?.();
            props.onOpenLibrary();
          } : void 0,
          "data-sidebar-library-link": true,
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: tokens.space.sm,
            padding: `${tokens.space.sm}px ${tokens.space.md}px`,
            fontSize: tokens.font.size.sm,
            color: tokens.color.accent,
            textDecoration: "none",
            border: `1px solid ${tokens.color.accentSoft}`,
            borderRadius: tokens.radius.md,
            background: tokens.color.surface
          }
        },
        "\u2699 \u7D20\u6750\u5E93 (Role / Member / Template)"
      )
    )
  );
}
function registerSidebarSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/sidebar: ctx.slots.inject unavailable; team sidebar skipped");
    return;
  }
  ctx.slots.inject(
    "sidebar.footer.action",
    () => ctx.slots.register(
      {
        name: "sidebar.footer.action",
        id: "team",
        order: 50,
        label: "DSH Team"
      },
      TeamSidebar
    )
  );
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "team-panel",
        order: 60,
        label: "DSH Team Panel"
      },
      TeamSidebar
    )
  );
}

// ui/team-handoff-card.js
function TeamHandoffCard(props) {
  const {
    from,
    to,
    task = "",
    contextRefs = [],
    artifacts = [],
    reason,
    state = "in_flight",
    variant = "normal"
  } = props;
  const isRedo = variant === "redo" || state === "redo";
  const accent = isRedo ? "#ef4444" : "#3b82f6";
  return createElement(
    "div",
    {
      className: "dsh-team-handoff-card",
      "data-variant": variant,
      "data-state": state,
      style: {
        border: `1px solid ${accent}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 6,
        padding: "10px 12px",
        margin: "8px 0",
        background: isRedo ? "#fef2f2" : "#eff6ff",
        fontSize: 13,
        color: "#111827"
      }
    },
    createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 6, marginBottom: 6 } },
      createElement("span", { style: { fontWeight: 600 } }, from),
      createElement("span", { style: { color: "#6b7280" } }, "\u2192"),
      createElement("span", { style: { fontWeight: 600 } }, to),
      createElement("span", {
        "data-state-pill": state,
        style: {
          marginLeft: "auto",
          padding: "1px 8px",
          borderRadius: 10,
          background: accent,
          color: "white",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase"
        }
      }, state)
    ),
    task ? createElement("div", { style: { color: "#1f2937", marginBottom: 6 } }, task) : null,
    reason ? createElement("div", { style: { color: "#6b7280", fontSize: 11, marginBottom: 4 } }, `reason: ${reason}`) : null,
    contextRefs.length > 0 ? createElement("div", { style: { fontSize: 11, color: "#4b5563" } }, `context: ${contextRefs.join(", ")}`) : null,
    artifacts.length > 0 ? createElement("div", { style: { fontSize: 11, color: "#059669", marginTop: 4 } }, `produced: ${artifacts.join(", ")}`) : null
  );
}

// ui/team-handoff-redo.js
function TeamHandoffRedo(props) {
  return createElement(TeamHandoffCard, {
    ...props,
    variant: "redo",
    state: props.state ?? "redo"
  });
}

// ui/conversation.js
var DENSITY = {
  "handoff-round-table": { a2a: 0.7, handoff: 0.3 },
  "pipeline-with-feedback": { a2a: 0.3, handoff: 0.7 },
  "fan-out-collect": { a2a: 0.6, handoff: 0.4 }
};
function renderEntry(e) {
  if (e.kind === "handoff" || e.kind === "handoff-redo") {
    const Card = e.kind === "handoff-redo" ? TeamHandoffRedo : TeamHandoffCard;
    return createElement(Card, { key: e.id, ...e });
  }
  if (e.kind === "a2a-message") {
    return createElement(
      "div",
      {
        key: e.id,
        className: "dsh-conversation-a2a",
        "data-entry-id": e.id,
        "data-in-reply-to": e.inReplyTo ?? "",
        "data-from": e.from,
        "data-to": e.to,
        "data-intent": e.intent,
        style: {
          padding: `${tokens.space.sm}px ${tokens.space.md}px`,
          margin: `${tokens.space.xs}px 0`,
          background: tokens.color.surfaceAlt,
          borderLeft: `3px solid ${intentColor(e.intent)}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.font.size.md,
          color: tokens.color.text,
          fontFamily: tokens.font.family
        }
      },
      createElement(
        "div",
        { className: "dsh-conversation-a2a-header", style: { fontSize: tokens.font.size.xs, color: tokens.color.muted, marginBottom: tokens.space.xs } },
        e.from && e.to ? `${e.from} \u2192 ${e.to}` : e.from ?? "",
        e.topic ? ` \xB7 ${e.topic}` : "",
        e.intent ? ` \xB7 ${e.intent}` : ""
      ),
      createElement(
        "div",
        { className: "dsh-conversation-a2a-body", "data-a2a-text": e.text ?? "", style: { whiteSpace: "pre-wrap" } },
        e.text ?? ""
      )
    );
  }
  if (e.kind === "decision") {
    return createElement(
      "div",
      {
        key: e.id,
        className: "dsh-conversation-decision",
        "data-entry-id": e.id,
        "data-decision-id": e.id,
        style: {
          padding: tokens.space.md,
          margin: `${tokens.space.xs}px 0`,
          background: tokens.color.warningSoft,
          borderLeft: `3px solid ${tokens.color.warning}`,
          borderRadius: tokens.radius.sm,
          fontSize: tokens.font.size.md,
          fontFamily: tokens.font.family
        }
      },
      createElement("div", { style: { fontWeight: tokens.font.weight.semibold, fontSize: tokens.font.size.sm, color: tokens.color.warning } }, "\u51B3\u7B56\u70B9"),
      createElement("div", { style: { marginTop: tokens.space.xs } }, e.text ?? "")
    );
  }
  return null;
}
function intentColor(intent) {
  if (!intent) return tokens.color.muted;
  return tokens.color.intent[
    /** @type {keyof typeof tokens.color.intent} */
    intent
  ] ?? tokens.color.muted;
}
function ConversationTimeline(props) {
  const entries = Array.isArray(props?.entries) ? props.entries.slice() : [];
  const flow = props?.flow ?? "handoff-round-table";
  const density = DENSITY[flow] ?? DENSITY["handoff-round-table"];
  entries.sort((a, b) => a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0);
  return createElement(
    "div",
    {
      className: "dsh-conversation-timeline",
      "data-flow": flow,
      "data-density-a2a": density.a2a,
      "data-density-handoff": density.handoff,
      style: {
        display: "flex",
        flexDirection: "column",
        gap: tokens.space.xs,
        padding: tokens.space.md,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text
      }
    },
    entries.length === 0 ? createElement(
      "div",
      { className: "dsh-conversation-empty", "data-empty": true, style: { padding: tokens.space.lg, color: tokens.color.muted, fontSize: tokens.font.size.md, fontStyle: "italic" } },
      props?.emptyMessage ?? "No messages yet."
    ) : entries.map(renderEntry)
  );
}
function registerConversationSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/conversation: ctx.slots.inject unavailable; team-timeline skipped");
    return;
  }
  ctx.slots.inject(
    "conversation.view",
    () => ctx.slots.register(
      {
        name: "conversation.view",
        id: "team-timeline",
        order: 100,
        label: "Team"
      },
      ConversationTimeline
    )
  );
}

// ui/tool.js
function TeamToolCall(props) {
  const { toolName, args, result, status = "complete", variant = "default" } = props;
  if (variant === "dispatch" || variant === "handoff") {
    return createElement(TeamHandoffCard, {
      id: toolName,
      from: args?.from,
      to: args?.to,
      task: args?.task,
      artifacts: args?.context_refs,
      reason: args?.reason,
      ...result ?? {}
    });
  }
  if (variant === "handoff-redo") {
    return createElement(TeamHandoffRedo, {
      id: toolName,
      from: args?.from,
      to: args?.to,
      task: args?.task,
      reason: args?.reason,
      ...result ?? {}
    });
  }
  return createElement(
    "div",
    {
      className: "dsh-team-tool-call",
      "data-tool-name": toolName,
      "data-status": status,
      "data-variant": variant,
      style: {
        padding: tokens.space.md,
        margin: `${tokens.space.xs}px 0`,
        background: tokens.color.surface,
        border: `1px solid ${tokens.color.border}`,
        borderLeft: `3px solid ${statusColor(status)}`,
        borderRadius: tokens.radius.md,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.md,
        color: tokens.color.text
      }
    },
    createElement(
      "div",
      { className: "dsh-team-tool-call-header", style: { display: "flex", alignItems: "center", gap: tokens.space.sm, marginBottom: tokens.space.xs } },
      createElement(
        "span",
        { "data-tool-name-pill": true, style: { padding: `1px ${tokens.space.sm}px`, borderRadius: tokens.radius.sm, background: tokens.color.surfaceMuted, color: tokens.color.text, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } },
        toolName
      ),
      createElement(
        "span",
        { "data-tool-status": status, style: { color: statusColor(status), fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } },
        status
      )
    ),
    args ? createElement(
      "details",
      { "data-tool-args": true, style: { fontSize: tokens.font.size.sm } },
      createElement("summary", { style: { cursor: "pointer", color: tokens.color.muted } }, "args"),
      createElement(
        "pre",
        { style: { margin: `${tokens.space.xs}px 0 0 0`, padding: tokens.space.sm, background: tokens.color.surfaceMuted, borderRadius: tokens.radius.sm, overflow: "auto", fontSize: tokens.font.size.xs } },
        JSON.stringify(args, null, 2)
      )
    ) : null,
    result ? createElement(
      "details",
      { "data-tool-result": true, open: true, style: { fontSize: tokens.font.size.sm, marginTop: tokens.space.xs } },
      createElement("summary", { style: { cursor: "pointer", color: tokens.color.muted } }, "result"),
      createElement(
        "pre",
        { style: { margin: `${tokens.space.xs}px 0 0 0`, padding: tokens.space.sm, background: tokens.color.surfaceMuted, borderRadius: tokens.radius.sm, overflow: "auto", fontSize: tokens.font.size.xs } },
        JSON.stringify(result, null, 2)
      )
    ) : null
  );
}
function statusColor(status) {
  if (status === "complete") return tokens.color.success;
  if (status === "failed") return tokens.color.danger;
  return tokens.color.warning;
}
var TEAM_TOOL_NAMES = Object.freeze([
  // 1.0 lifecycle (8)
  "team.start",
  "team.list",
  "team.abort",
  "team.list_runs",
  "team.rerun",
  "team.resume",
  "team.check_cost_cap",
  "team.list_adapters",
  // 1.5 decision points (3)
  "team.open_decision_point",
  "team.respond_decision_point",
  "team.list_decision_points",
  // 1.5 step / branch signals (4)
  "team.complete_step",
  "team.fail_step",
  "team.complete_branch",
  "team.fail_branch",
  // 1.5 plan (2)
  "team.add_plan",
  "team.list_plans",
  // 1.5 artifact (3)
  "team.register_artifact",
  "team.list_artifacts",
  "team.delete_artifact",
  // 2.0 CRUD role / member / template (9)
  "team.create_role",
  "team.update_role",
  "team.delete_role",
  "team.create_member",
  "team.update_member",
  "team.delete_member",
  "team.create_template",
  "team.update_template",
  "team.delete_template"
]);
function registerToolSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/tool: ctx.slots.inject unavailable; team.* tool views skipped");
    return;
  }
  for (const toolName of TEAM_TOOL_NAMES) {
    ctx.slots.inject(
      "tool.call.toolview",
      () => ctx.slots.register(
        {
          name: "tool.call.toolview",
          key: toolName,
          label: `DSH Team Tool: ${toolName}`
        },
        TeamToolCall
      )
    );
  }
}

// ui/team-config.js
var ADAPTER_OPTIONS = ["hermes", "mcode", "claude-code"];
var FLOW_OPTIONS = ["handoff-round-table", "pipeline-with-feedback", "fan-out-collect"];
function pickTab(props) {
  const t = props?.activeTab;
  return t === "members" || t === "templates" ? t : "roles";
}
function EntityForm(props) {
  const { kind, fields, initial = {}, onSubmit, onCancel } = props;
  return createElement(
    "form",
    {
      className: `dsh-team-config-form dsh-team-config-form--${kind}`,
      "data-form-kind": kind,
      style: { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid #e5e7eb", borderRadius: 6, background: "#fafafa" },
      onSubmit: onSubmit ? (e) => {
        e?.preventDefault?.();
        onSubmit(initial);
      } : void 0
    },
    createElement(
      "div",
      { className: "dsh-team-config-form-title", style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } },
      initial?.id ? `Edit ${kind} "${initial.id}"` : `Create ${kind}`
    ),
    ...fields.map((f) => renderField(f, initial)),
    createElement(
      "div",
      { className: "dsh-team-config-form-actions", style: { display: "flex", gap: 6, marginTop: 4 } },
      createElement("button", {
        type: "submit",
        "data-action": "save",
        style: { padding: "4px 12px", fontSize: 12, background: "#3b82f6", color: "white", border: "none", borderRadius: 4, cursor: "pointer" }
      }, "Save"),
      onCancel ? createElement("button", {
        type: "button",
        "data-action": "cancel",
        onClick: onCancel,
        style: { padding: "4px 12px", fontSize: 12, background: "#fff", color: "#374151", border: "1px solid #d1d5db", borderRadius: 4, cursor: "pointer" }
      }, "Cancel") : null
    )
  );
}
function renderField(field, initial) {
  const { name, label, type, options, required } = field;
  const value = initial?.[name] ?? "";
  if (type === "select") {
    return createElement(
      "label",
      { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#374151" } },
      createElement("span", null, label),
      createElement(
        "select",
        {
          name,
          "data-input": name,
          defaultValue: String(value),
          style: { padding: "4px 6px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4 }
        },
        ...(options ?? []).map(
          (o) => createElement("option", { key: o, value: o, selected: o === value }, o)
        )
      )
    );
  }
  if (type === "textarea") {
    return createElement(
      "label",
      { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#374151" } },
      createElement("span", null, label),
      createElement("textarea", {
        name,
        "data-input": name,
        defaultValue: String(value),
        required: required === true,
        rows: 3,
        style: { padding: "4px 6px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4, fontFamily: "inherit" }
      })
    );
  }
  return createElement(
    "label",
    { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 2, fontSize: 11, color: "#374151" } },
    createElement("span", null, label),
    createElement("input", {
      name,
      "data-input": name,
      type: "text",
      defaultValue: String(value),
      required: required === true,
      style: { padding: "4px 6px", fontSize: 12, border: "1px solid #d1d5db", borderRadius: 4 }
    })
  );
}
function EntityTab(props) {
  const { kind, items, formFields, renderItem, initialForm, onSubmit, onDelete } = props;
  return createElement(
    "div",
    { className: `dsh-team-config-tab dsh-team-config-tab--${kind}`, "data-tab": kind, style: { display: "flex", flexDirection: "column", gap: 12 } },
    createElement(
      "div",
      { className: "dsh-team-config-list", "data-list": kind, style: { display: "flex", flexDirection: "column", gap: 4 } },
      items.length === 0 ? createElement(
        "div",
        { className: "dsh-team-config-empty", "data-empty": true, style: { color: "#6b7280", fontSize: 12, padding: 8 } },
        `No ${kind} yet. Use the form below to create one.`
      ) : items.map(
        (it) => createElement(
          "div",
          {
            key: it?.id ?? JSON.stringify(it),
            className: "dsh-team-config-list-item",
            "data-item-id": it?.id,
            style: { display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", border: "1px solid #e5e7eb", borderRadius: 4, fontSize: 12 }
          },
          renderItem(it),
          onDelete ? createElement("button", {
            type: "button",
            "data-action": "delete",
            onClick: () => onDelete(it?.id),
            style: { marginLeft: "auto", padding: "2px 8px", fontSize: 11, color: "#b91c1c", background: "white", border: "1px solid #fecaca", borderRadius: 3, cursor: "pointer" }
          }, "Delete") : null
        )
      )
    ),
    createElement(EntityForm, { kind, fields: formFields, initial: initialForm, onSubmit })
  );
}
function renderRoleItem(role) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto" } },
    createElement("span", { "data-role-adapter": role?.adapter, style: { padding: "1px 6px", background: "#dbeafe", color: "#1e40af", borderRadius: 8, fontSize: 10, fontWeight: 600 } }, role?.adapter ?? "?"),
    createElement("strong", { "data-role-id": role?.id }, role?.id ?? "?"),
    createElement("span", { "data-role-display-name": true, style: { color: "#6b7280", fontSize: 11 } }, role?.display_name ?? "")
  );
}
function renderMemberItem(m) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto" } },
    createElement("span", { "data-member-adapter": m?.adapter, style: { padding: "1px 6px", background: "#dcfce7", color: "#166534", borderRadius: 8, fontSize: 10, fontWeight: 600 } }, m?.adapter ?? "?"),
    createElement("strong", { "data-member-id": m?.id }, m?.id ?? "?"),
    createElement("span", { style: { color: "#6b7280", fontSize: 11 } }, `role: ${m?.role_id ?? "?"}`),
    createElement("span", { "data-member-display-name": true, style: { color: "#6b7280", fontSize: 11 } }, m?.display_name ?? "")
  );
}
function renderTemplateItem(t) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto" } },
    createElement("span", { "data-template-flow": t?.flow, style: { padding: "1px 6px", background: "#fef3c7", color: "#854d0e", borderRadius: 8, fontSize: 10, fontWeight: 600 } }, t?.flow ?? "?"),
    createElement("strong", { "data-template-id": t?.id }, t?.id ?? "?"),
    createElement("span", { style: { color: "#6b7280", fontSize: 11 } }, `${t?.members?.length ?? 0} member(s)`)
  );
}
function TeamConfigPanel(props) {
  const roles = Array.isArray(props?.roles) ? props.roles : [];
  const members = Array.isArray(props?.members) ? props.members : [];
  const templates = Array.isArray(props?.templates) ? props.templates : [];
  const active = pickTab(props);
  if (props?.error) {
    return createElement(
      "div",
      { className: "dsh-team-config dsh-team-config--error", "data-state": "error", style: { padding: 12, color: "#b91c1c", fontSize: 12 } },
      `Failed to load configuration: ${props.error}`
    );
  }
  if (roles.length === 0 && members.length === 0 && templates.length === 0 && !props?.onChangeTab && !props?.activeTab) {
    return createElement(
      "div",
      { className: "dsh-team-config dsh-team-config--loading", "data-state": "loading", style: { padding: 12, color: "#6b7280", fontSize: 12, fontStyle: "italic" } },
      "Loading configuration\u2026"
    );
  }
  return createElement(
    "div",
    {
      className: "dsh-team-config",
      "data-state": "content",
      "data-active-tab": active,
      style: { padding: 12, fontSize: 13, color: "#111827" }
    },
    createElement(
      "div",
      { className: "dsh-team-config-header", style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 } },
      createElement("strong", { style: { fontSize: 15 } }, "DSH Team Configuration"),
      createElement("span", { style: { color: "#6b7280", fontSize: 11 } }, `${roles.length} role(s) / ${members.length} member(s) / ${templates.length} template(s)`)
    ),
    createElement(
      "div",
      { className: "dsh-team-config-tabs", "data-tabs": true, style: { display: "flex", gap: 4, borderBottom: "1px solid #e5e7eb", marginBottom: 12 } },
      createElement("button", {
        type: "button",
        "data-tab-key": "roles",
        "aria-pressed": active === "roles",
        onClick: props?.onChangeTab ? () => props.onChangeTab("roles") : void 0,
        style: tabButtonStyle(active === "roles")
      }, `Roles (${roles.length})`),
      createElement("button", {
        type: "button",
        "data-tab-key": "members",
        "aria-pressed": active === "members",
        onClick: props?.onChangeTab ? () => props.onChangeTab("members") : void 0,
        style: tabButtonStyle(active === "members")
      }, `Members (${members.length})`),
      createElement("button", {
        type: "button",
        "data-tab-key": "templates",
        "aria-pressed": active === "templates",
        onClick: props?.onChangeTab ? () => props.onChangeTab("templates") : void 0,
        style: tabButtonStyle(active === "templates")
      }, `Templates (${templates.length})`)
    ),
    active === "roles" ? createElement(EntityTab, {
      key: "roles",
      kind: "role",
      items: roles,
      renderItem: renderRoleItem,
      initialForm: { id: "", display_name: "", persona: "", adapter: "hermes", tools_allowed: "", avatar_color: "#3b82f6", avatar_shape: "circle" },
      formFields: [
        { name: "id", label: "ID", type: "text", required: true },
        { name: "display_name", label: "Display Name", type: "text", required: true },
        { name: "persona", label: "Persona", type: "textarea" },
        { name: "adapter", label: "Adapter", type: "select", options: ADAPTER_OPTIONS, required: true },
        { name: "tools_allowed", label: "Tools Allowed (comma-sep)", type: "text" },
        { name: "avatar_color", label: "Avatar Color", type: "text" },
        { name: "avatar_shape", label: "Avatar Shape", type: "text" }
      ],
      onSubmit: props?.onSubmitRole,
      onDelete: props?.onDelete ? (id) => props.onDelete("role", id) : void 0
    }) : null,
    active === "members" ? createElement(EntityTab, {
      key: "members",
      kind: "member",
      items: members,
      renderItem: renderMemberItem,
      initialForm: { id: "", role_id: roles[0]?.id ?? "", display_name: "", persona: "", adapter: "hermes" },
      formFields: [
        { name: "id", label: "ID", type: "text", required: true },
        { name: "role_id", label: "Role", type: "select", options: roles.map((r) => r.id), required: true },
        { name: "display_name", label: "Display Name", type: "text", required: true },
        { name: "persona", label: "Persona", type: "textarea" },
        { name: "adapter", label: "Adapter", type: "select", options: ADAPTER_OPTIONS, required: true }
      ],
      onSubmit: props?.onSubmitMember,
      onDelete: props?.onDelete ? (id) => props.onDelete("member", id) : void 0
    }) : null,
    active === "templates" ? createElement(EntityTab, {
      key: "templates",
      kind: "template",
      items: templates,
      renderItem: renderTemplateItem,
      initialForm: { id: "", name: "", flow: "handoff-round-table", members_json: JSON.stringify([{ member_id: members[0]?.id ?? "", instance_alias: "a" }], null, 2) },
      formFields: [
        { name: "id", label: "ID", type: "text", required: true },
        { name: "name", label: "Name", type: "text", required: true },
        { name: "flow", label: "Flow", type: "select", options: FLOW_OPTIONS, required: true },
        { name: "members_json", label: "Members (JSON)", type: "textarea" }
      ],
      onSubmit: props?.onSubmitTemplate,
      onDelete: props?.onDelete ? (id) => props.onDelete("template", id) : void 0
    }) : null
  );
}
function tabButtonStyle(active) {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: "transparent",
    color: active ? "#1e40af" : "#6b7280",
    border: "none",
    borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1
  };
}

// ui/team-config-host.js
var NOOP = () => {
};
function TeamConfigPanelHost(_props) {
  return createElement(TeamConfigPanel, {
    onChangeTab: NOOP,
    onSubmitRole: NOOP,
    onSubmitMember: NOOP,
    onSubmitTemplate: NOOP,
    onDelete: NOOP
  });
}

// ui/team-panel.js
function registerTeamSlots(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/team-panel: ctx.slots.inject unavailable; team settings section skipped");
    return;
  }
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "team",
        order: 100,
        label: "Team"
      },
      TeamConfigPanelHost
    )
  );
}

// src/client.js
var inject = ["slots"];
function apply(ctx) {
  if (!ctx?.slots?.inject) {
    ctx?.logger?.warn?.("dsh-team-plugin/client: ctx.slots.inject unavailable; no client slots registered");
    return;
  }
  registerLayoutSlot(ctx);
  registerSidebarSlot(ctx);
  registerConversationSlot(ctx);
  registerToolSlot(ctx);
  registerTeamSlots(ctx);
  ctx?.logger?.info?.("dsh-team-plugin/client: registered settings.section (id=team) + shell.overlay (team-topbar / team-footer / team-panel) + sidebar.footer.action (id=team) + conversation.view (id=team-timeline) + tool.call.toolview (29 team.* keys)");
}
return module.exports; } });
