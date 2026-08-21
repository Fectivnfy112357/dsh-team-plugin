var module = { exports: {} };
var exports = module.exports;
window.__ModuleLoader__.load({ id: "dsh-team-plugin", factory: (require) => {
var React = require("react");
globalThis.React = React;
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
function registerLayoutSlot(ctx) {
  if (!ctx?.slots?.inject || typeof ctx.slots.register !== "function") {
    ctx?.logger?.warn?.("dsh-team-plugin/ui/layout: ctx.slots.inject unavailable; layout registrar skipped (currently a no-op)");
    return;
  }
}

// ui/sidebar.js
function TeamSidebarFooterIcon(_props) {
  return createElement(
    "button",
    {
      type: "button",
      className: "dsh-team-sidebar-icon",
      "data-component": "sidebar-icon",
      "data-action": "team",
      title: "DSH Team (panel coming once data layer lands \u2014 see PROGRESS.md \xA74 \u7559\u53E3)",
      style: {
        appearance: "none",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        padding: 0,
        border: "none",
        borderRadius: tokens.radius.md,
        background: "transparent",
        color: tokens.color.text,
        fontFamily: tokens.font.family,
        fontSize: tokens.font.size.lg,
        fontWeight: tokens.font.weight.semibold,
        cursor: "pointer"
      }
    },
    // The bullet mark mirrors the brand in the topbar so the icon is
    // recognisable as ours without committing to a glyph we're not
    // sure the icon set has on every host platform.
    createElement("span", {
      "data-icon-mark": true,
      style: {
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: tokens.radius.pill,
        background: tokens.color.accent
      }
    })
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
      TeamSidebarFooterIcon
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
var L = {
  // Header
  configTitle: "DSH \u56E2\u961F\u914D\u7F6E",
  summary: (r, m, t) => `${r} \u4E2A\u89D2\u8272 / ${m} \u4E2A\u6210\u5458 / ${t} \u4E2A\u56E2\u961F\u6A21\u677F`,
  // Tabs
  tabRoles: (n) => `\u89D2\u8272\uFF08${n}\uFF09`,
  tabMembers: (n) => `\u6210\u5458\uFF08${n}\uFF09`,
  tabTemplates: (n) => `\u56E2\u961F\u6A21\u677F\uFF08${n}\uFF09`,
  // Empty states
  emptyRole: "\u6682\u65E0\u89D2\u8272\u3002\u4F7F\u7528\u4E0B\u65B9\u8868\u5355\u521B\u5EFA\u3002",
  emptyMember: "\u6682\u65E0\u6210\u5458\u3002\u4F7F\u7528\u4E0B\u65B9\u8868\u5355\u521B\u5EFA\u3002",
  emptyTemplate: "\u6682\u65E0\u56E2\u961F\u6A21\u677F\u3002\u4F7F\u7528\u4E0B\u65B9\u8868\u5355\u521B\u5EFA\u3002",
  // Form titles
  createRole: "\u521B\u5EFA\u89D2\u8272",
  createMember: "\u521B\u5EFA\u6210\u5458",
  createTemplate: "\u521B\u5EFA\u56E2\u961F\u6A21\u677F",
  // Field labels (schema field name → 中文)
  fieldLabel: {
    id: "ID",
    display_name: "\u663E\u793A\u540D\u79F0",
    persona: "\u4EBA\u8BBE\u63CF\u8FF0",
    adapter: "\u9002\u914D\u5668",
    tools_allowed: "\u5141\u8BB8\u7684\u5DE5\u5177\uFF08\u82F1\u6587\u9017\u53F7\u5206\u9694\uFF09",
    avatar_color: "\u5934\u50CF\u989C\u8272",
    avatar_shape: "\u5934\u50CF\u5F62\u72B6",
    role_id: "\u6240\u5C5E\u89D2\u8272",
    name: "\u6A21\u677F\u540D\u79F0",
    flow: "\u534F\u4F5C\u6A21\u5F0F",
    members_json: "\u6210\u5458\uFF08JSON \u683C\u5F0F\uFF09"
  },
  // Buttons
  save: "\u4FDD\u5B58",
  cancel: "\u53D6\u6D88",
  delete: "\u5220\u9664",
  // States
  loading: "\u52A0\u8F7D\u914D\u7F6E\u4E2D\u2026",
  errorPrefix: "\u52A0\u8F7D\u914D\u7F6E\u5931\u8D25\uFF1A",
  // Save feedback (31st commit)
  savedAt: "\u5DF2\u4FDD\u5B58",
  savedNote: "\u6570\u636E\u5C42\u89C1 PROGRESS.md \xA74 \u7559\u53E3\uFF08\u6682\u5B58\u4E8E\u63A7\u5236\u53F0\uFF0C\xA74 \u843D\u5730\u540E\u771F\u6B63\u5199\u5165\uFF09\u3002"
};
function pickTab(props, local) {
  if (props?.activeTab === "members" || props?.activeTab === "templates" || props?.activeTab === "roles") {
    return props.activeTab;
  }
  return local;
}
function EntityForm(props) {
  const { kind, fields, initial = {}, onSubmit, onCancel } = props;
  const title = kind === "role" ? L.createRole : kind === "member" ? L.createMember : L.createTemplate;
  const React = typeof globalThis !== "undefined" && globalThis.React || void 0;
  const useState = React && typeof React.useState === "function" ? React.useState : null;
  const [savedAt, setSavedAt] = useState ? useState(null) : [null, () => {
  }];
  return createElement(
    "form",
    {
      className: `dsh-team-config-form dsh-team-config-form--${kind}`,
      "data-form-kind": kind,
      "data-saved-at": savedAt ? String(savedAt) : void 0,
      style: { display: "flex", flexDirection: "column", gap: 10, padding: 14, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, marginTop: 12 },
      // ALWAYS set the onSubmit so we can preventDefault unconditionally.
      // Without this, clicking Save with no parent callback = the
      // browser's default form submission kicks in = page reload
      // (the user-reported bug).
      onSubmit: (e) => {
        e?.preventDefault?.();
        if (typeof onSubmit !== "function") {
          setSavedAt(Date.now());
          return;
        }
        let payload = initial;
        try {
          const fd = new FormData(e.target);
          payload = {};
          for (const [k, v] of fd.entries()) {
            payload[k] = typeof v === "string" ? v : "";
          }
        } catch {
          payload = initial;
        }
        const result = onSubmit(payload);
        if (result && typeof result.then === "function") {
          result.then(() => setSavedAt(Date.now()), () => setSavedAt(Date.now()));
        } else {
          setSavedAt(Date.now());
        }
      }
    },
    createElement(
      "div",
      { className: "dsh-team-config-form-title", style: { fontWeight: tokens.font.weight.semibold, fontSize: tokens.font.size.lg, marginBottom: 2, color: tokens.color.text } },
      title
    ),
    ...fields.map((f) => renderField(f, initial)),
    savedAt ? createElement(
      "div",
      { className: "dsh-team-config-form-saved", "data-saved": true, role: "status", style: { color: tokens.color.success, fontSize: tokens.font.size.sm, padding: "4px 0 0" } },
      `\u2713 ${L.savedAt}\uFF08${new Date(savedAt).toLocaleTimeString()}\uFF09\u2014 ${L.savedNote}`
    ) : null,
    createElement(
      "div",
      { className: "dsh-team-config-form-actions", style: { display: "flex", gap: 8, marginTop: 6 } },
      createElement("button", {
        type: "submit",
        "data-action": "save",
        style: { padding: `6px 14px`, fontSize: tokens.font.size.md, background: tokens.color.accent, color: "white", border: "none", borderRadius: tokens.radius.md, cursor: "pointer", fontWeight: tokens.font.weight.medium }
      }, L.save),
      onCancel ? createElement("button", {
        type: "button",
        "data-action": "cancel",
        onClick: onCancel,
        style: { padding: `6px 14px`, fontSize: tokens.font.size.md, background: tokens.color.surface, color: tokens.color.text, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, cursor: "pointer", fontWeight: tokens.font.weight.medium }
      }, L.cancel) : null
    )
  );
}
function renderField(field, initial) {
  const { name, type, options, required } = field;
  const label = L.fieldLabel[name] ?? field.label ?? name;
  const value = initial?.[name] ?? "";
  if (type === "select") {
    return createElement(
      "label",
      { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
      createElement("span", { style: { fontWeight: tokens.font.weight.medium } }, label),
      createElement(
        "select",
        {
          name,
          "data-input": name,
          defaultValue: String(value),
          style: { padding: "6px 8px", fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, color: tokens.color.text, fontFamily: "inherit" }
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
      { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
      createElement("span", { style: { fontWeight: tokens.font.weight.medium } }, label),
      createElement("textarea", {
        name,
        "data-input": name,
        defaultValue: String(value),
        required: required === true,
        rows: 3,
        style: { padding: "6px 8px", fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, fontFamily: "inherit", background: tokens.color.surface, color: tokens.color.text, resize: "vertical" }
      })
    );
  }
  return createElement(
    "label",
    { key: name, "data-field": name, style: { display: "flex", flexDirection: "column", gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
    createElement("span", { style: { fontWeight: tokens.font.weight.medium } }, label),
    createElement("input", {
      name,
      "data-input": name,
      type: "text",
      defaultValue: String(value),
      required: required === true,
      style: { padding: "6px 8px", fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, color: tokens.color.text, fontFamily: "inherit" }
    })
  );
}
function EntityTab(props) {
  const { kind, items, formFields, renderItem, initialForm, onSubmit, onDelete } = props;
  const emptyText = kind === "role" ? L.emptyRole : kind === "member" ? L.emptyMember : L.emptyTemplate;
  return createElement(
    "div",
    { className: `dsh-team-config-tab dsh-team-config-tab--${kind}`, "data-tab": kind, style: { display: "flex", flexDirection: "column", gap: 12 } },
    createElement(
      "div",
      { className: "dsh-team-config-list", "data-list": kind, style: { display: "flex", flexDirection: "column", gap: 6 } },
      items.length === 0 ? createElement(
        "div",
        { className: "dsh-team-config-empty", "data-empty": true, style: { color: tokens.color.muted, fontSize: tokens.font.size.md, padding: 10, fontStyle: "italic", textAlign: "center" } },
        emptyText
      ) : items.map(
        (it) => createElement(
          "div",
          {
            key: it?.id ?? JSON.stringify(it),
            className: "dsh-team-config-list-item",
            "data-item-id": it?.id,
            style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, fontSize: tokens.font.size.md, background: tokens.color.surface }
          },
          renderItem(it),
          onDelete ? createElement("button", {
            type: "button",
            "data-action": "delete",
            onClick: () => onDelete(it?.id),
            style: { marginLeft: "auto", padding: "4px 10px", fontSize: tokens.font.size.sm, color: tokens.color.danger, background: "white", border: `1px solid ${tokens.color.dangerSoft}`, borderRadius: tokens.radius.sm, cursor: "pointer" }
          }, L.delete) : null
        )
      )
    ),
    createElement(EntityForm, { kind, fields: formFields, initial: initialForm, onSubmit })
  );
}
function renderRoleItem(role) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto" } },
    createElement("span", { "data-role-adapter": role?.adapter, style: { padding: "2px 8px", background: tokens.color.accentSoft, color: tokens.color.accent, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, role?.adapter ?? "?"),
    createElement("strong", { "data-role-id": role?.id, style: { fontFamily: "monospace" } }, role?.id ?? "?"),
    createElement("span", { "data-role-display-name": true, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, role?.display_name ?? "")
  );
}
function renderMemberItem(m) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto" } },
    createElement("span", { "data-member-adapter": m?.adapter, style: { padding: "2px 8px", background: tokens.color.successSoft, color: tokens.color.success, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, m?.adapter ?? "?"),
    createElement("strong", { "data-member-id": m?.id, style: { fontFamily: "monospace" } }, m?.id ?? "?"),
    createElement("span", { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, `\u89D2\u8272\uFF1A${m?.role_id ?? "?"}`),
    createElement("span", { "data-member-display-name": true, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, m?.display_name ?? "")
  );
}
function renderTemplateItem(t) {
  return createElement(
    "div",
    { style: { display: "flex", alignItems: "center", gap: 10, flex: "1 1 auto" } },
    createElement("span", { "data-template-flow": t?.flow, style: { padding: "2px 8px", background: tokens.color.warningSoft, color: tokens.color.warning, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, t?.flow ?? "?"),
    createElement("strong", { "data-template-id": t?.id, style: { fontFamily: "monospace" } }, t?.id ?? "?"),
    createElement("span", { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, `${t?.members?.length ?? 0} \u4E2A\u6210\u5458`)
  );
}
function TeamConfigPanel(props) {
  const React = typeof globalThis !== "undefined" && globalThis.React || void 0;
  const useState = React && typeof React.useState === "function" ? React.useState : null;
  const roles = Array.isArray(props?.roles) ? props.roles : [];
  const members = Array.isArray(props?.members) ? props.members : [];
  const templates = Array.isArray(props?.templates) ? props.templates : [];
  const [localTab, setLocalTab] = useState ? useState("roles") : ["roles", () => {
  }];
  const active = pickTab(props, localTab);
  const onChangeTab = props?.onChangeTab ?? ((next) => {
    if (useState) setLocalTab(next);
  });
  if (props?.error) {
    return createElement(
      "div",
      { className: "dsh-team-config dsh-team-config--error", "data-state": "error", style: { padding: 12, color: tokens.color.danger, fontSize: tokens.font.size.md } },
      `${L.errorPrefix}${props.error}`
    );
  }
  if (roles.length === 0 && members.length === 0 && templates.length === 0 && !props?.onChangeTab && !props?.activeTab && !useState) {
    return createElement(
      "div",
      { className: "dsh-team-config dsh-team-config--loading", "data-state": "loading", style: { padding: 12, color: tokens.color.muted, fontSize: tokens.font.size.md, fontStyle: "italic" } },
      L.loading
    );
  }
  return createElement(
    "div",
    {
      className: "dsh-team-config",
      "data-state": "content",
      "data-active-tab": active,
      style: { padding: "4px 4px 16px", fontSize: tokens.font.size.md, color: tokens.color.text, maxWidth: 720 }
    },
    createElement(
      "div",
      { className: "dsh-team-config-header", style: { display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 } },
      createElement("strong", { style: { fontSize: 18, fontWeight: tokens.font.weight.semibold } }, L.configTitle),
      createElement("span", { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, L.summary(roles.length, members.length, templates.length))
    ),
    createElement(
      "div",
      { className: "dsh-team-config-tabs", "data-tabs": true, style: { display: "flex", gap: 4, borderBottom: `1px solid ${tokens.color.border}`, marginBottom: 4 } },
      createElement("button", {
        type: "button",
        "data-tab-key": "roles",
        "aria-pressed": active === "roles",
        onClick: () => onChangeTab("roles"),
        style: tabButtonStyle(active === "roles")
      }, L.tabRoles(roles.length)),
      createElement("button", {
        type: "button",
        "data-tab-key": "members",
        "aria-pressed": active === "members",
        onClick: () => onChangeTab("members"),
        style: tabButtonStyle(active === "members")
      }, L.tabMembers(members.length)),
      createElement("button", {
        type: "button",
        "data-tab-key": "templates",
        "aria-pressed": active === "templates",
        onClick: () => onChangeTab("templates"),
        style: tabButtonStyle(active === "templates")
      }, L.tabTemplates(templates.length))
    ),
    active === "roles" ? createElement(EntityTab, {
      key: "roles",
      kind: "role",
      items: roles,
      renderItem: renderRoleItem,
      initialForm: { id: "", display_name: "", persona: "", adapter: "hermes", tools_allowed: "", avatar_color: tokens.color.accent, avatar_shape: "circle" },
      formFields: [
        { name: "id", label: "ID", type: "text", required: true },
        { name: "display_name", label: "\u663E\u793A\u540D\u79F0", type: "text", required: true },
        { name: "persona", label: "\u4EBA\u8BBE\u63CF\u8FF0", type: "textarea" },
        { name: "adapter", label: "\u9002\u914D\u5668", type: "select", options: ADAPTER_OPTIONS, required: true },
        { name: "tools_allowed", label: "\u5141\u8BB8\u7684\u5DE5\u5177", type: "text" },
        { name: "avatar_color", label: "\u5934\u50CF\u989C\u8272", type: "text" },
        { name: "avatar_shape", label: "\u5934\u50CF\u5F62\u72B6", type: "text" }
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
        { name: "role_id", label: "\u6240\u5C5E\u89D2\u8272", type: "select", options: roles.map((r) => r.id), required: true },
        { name: "display_name", label: "\u663E\u793A\u540D\u79F0", type: "text", required: true },
        { name: "persona", label: "\u4EBA\u8BBE\u63CF\u8FF0", type: "textarea" },
        { name: "adapter", label: "\u9002\u914D\u5668", type: "select", options: ADAPTER_OPTIONS, required: true }
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
        { name: "name", label: "\u6A21\u677F\u540D\u79F0", type: "text", required: true },
        { name: "flow", label: "\u534F\u4F5C\u6A21\u5F0F", type: "select", options: FLOW_OPTIONS, required: true },
        { name: "members_json", label: "\u6210\u5458\uFF08JSON \u683C\u5F0F\uFF09", type: "textarea" }
      ],
      onSubmit: props?.onSubmitTemplate,
      onDelete: props?.onDelete ? (id) => props.onDelete("template", id) : void 0
    }) : null
  );
}
function tabButtonStyle(active) {
  return {
    padding: "8px 14px",
    fontSize: tokens.font.size.md,
    fontWeight: active ? tokens.font.weight.semibold : tokens.font.weight.normal,
    background: "transparent",
    color: active ? tokens.color.accent : tokens.color.muted,
    border: "none",
    borderBottom: active ? `2px solid ${tokens.color.accent}` : "2px solid transparent",
    cursor: "pointer",
    marginBottom: -1
  };
}

// ui/sample-data.js
var ROLE_RESEARCHER = {
  id: "researcher",
  display_name: "\u7814\u7A76\u5458",
  persona: "\u4F60\u662F\u4E00\u4F4D\u4E25\u8C28\u7684\u7814\u7A76\u5458\u3002\u4EFB\u52A1\u6765\u4E86\u5148\u62C6\u89E3\u6210 3-5 \u4E2A\u5B50\u95EE\u9898\uFF0C\u518D\u51B3\u5B9A\u6BCF\u4E2A\u5B50\u95EE\u9898\u7528 web \u641C\u7D22\u3001\u8BFB\u672C\u5730\u6587\u4EF6\u3001\u8FD8\u662F\u95EE\u4E0A\u6E38\u3002\u7ED3\u8BBA\u5FC5\u987B\u6709\u5F15\u7528\u652F\u6491\uFF0C\u4E0D\u80FD\u51ED\u5370\u8C61\u4E0B\u5224\u65AD\u3002",
  adapter: "hermes",
  cli_options: {},
  tools_allowed: ["web_search", "web_fetch", "read", "write"],
  avatar: { color: "#3b82f6", shape: "circle" }
};
var ROLE_ENGINEER = {
  id: "engineer",
  display_name: "\u5DE5\u7A0B\u5E08",
  persona: "\u4F60\u662F\u4E00\u4F4D\u80FD\u843D\u5730\u7684\u5DE5\u7A0B\u5E08\u3002\u63A5\u5230\u9700\u6C42\u5148\u60F3\u6E05\u695A\u63A5\u53E3\u548C\u8FB9\u754C\u6761\u4EF6\uFF0C\u5199\u4EE3\u7801\u524D\u5148\u5217 plan\u3002\u6539\u5B8C\u81EA\u5DF1\u8DD1\u6D4B\u8BD5/\u6784\u5EFA\u9A8C\u8BC1\uFF0C\u4E0D\u8981\u7529\u9505\u3002\u51FA\u9519\u65F6\u9644\u5B8C\u6574 stacktrace \u548C\u4F60\u5C1D\u8BD5\u8FC7\u7684\u4FEE\u590D\u3002",
  adapter: "hermes",
  cli_options: {},
  tools_allowed: ["read", "write", "edit", "bash", "grep", "glob"],
  avatar: { color: "#22c55e", shape: "square" }
};
var ROLE_REVIEWER = {
  id: "reviewer",
  display_name: "\u8BC4\u5BA1\u5458",
  persona: "\u4F60\u662F\u4E00\u4F4D\u6311\u5254\u4F46\u5EFA\u8BBE\u6027\u7684\u8BC4\u5BA1\u5458\u3002\u770B\u5230\u4EE3\u7801\u5148\u627E\u98CE\u9669\uFF1A\u8FB9\u754C\u6761\u4EF6\u3001\u5E76\u53D1\u3001\u9519\u8BEF\u5904\u7406\u3001\u4F9D\u8D56\u9690\u60A3\u3002\u7ED9\u53CD\u9988\u65F6\u6309\u300C\u5FC5\u987B\u6539 / \u5EFA\u8BAE\u6539 / \u9526\u4E0A\u6DFB\u82B1\u300D\u4E09\u6863\u6807\uFF0C\u4E0D\u8981\u5939\u5E26\u4E2A\u4EBA\u504F\u597D\u3002",
  adapter: "mcode",
  cli_options: {},
  tools_allowed: ["read", "grep", "glob"],
  avatar: { color: "#f97316", shape: "triangle" }
};
var ROLE_WRITER = {
  id: "writer",
  display_name: "\u64B0\u7A3F\u4EBA",
  persona: "\u4F60\u662F\u4E00\u4F4D\u6E05\u6670\u7684\u64B0\u7A3F\u4EBA\u3002\u5148\u5217\u5927\u7EB2\u518D\u52A8\u7B14\uFF0C\u6280\u672F\u672F\u8BED\u7B2C\u4E00\u6B21\u51FA\u73B0\u65F6\u7528\u4E00\u53E5\u8BDD\u89E3\u91CA\u3002\u6539\u7A3F\u65F6\u5148\u95EE\u81EA\u5DF1\uFF1A\u8BFB\u8005\u8BFB\u5230\u8FD9\u91CC\u4F1A\u4E0D\u4F1A\u5361\uFF1F",
  adapter: "claude-code",
  cli_options: {},
  tools_allowed: ["read", "write", "web_search"],
  avatar: { color: "#a855f7", shape: "circle" }
};
var MEMBER_ALICE = {
  id: "alice",
  role_id: "researcher",
  display_name: "Alice",
  persona: "\u524D 5 \u5206\u949F\u5148\u505A\u6280\u672F\u8C03\u7814\uFF0C\u5F15\u7528\u81F3\u5C11 3 \u4E2A\u6765\u6E90\uFF0C\u5217\u51FA\u5173\u952E\u4E8B\u5B9E\u548C\u5206\u6B67\u3002",
  adapter: "hermes",
  cli_options_override: {},
  metadata: { timezone: "Asia/Shanghai", language: "zh-CN" }
};
var MEMBER_BOB = {
  id: "bob",
  role_id: "engineer",
  display_name: "Bob",
  persona: "\u540E\u7AEF\u5DE5\u7A0B\u5E08\uFF0C\u4E60\u60EF\u5728\u5199\u4EE3\u7801\u524D\u5148\u753B\u72B6\u6001\u673A\u548C\u8FB9\u754C\u3002Go/Rust/TypeScript \u90FD\u884C\u3002",
  adapter: "hermes",
  cli_options_override: {},
  metadata: { primary_languages: ["typescript", "go"], seniority: "senior" }
};
var MEMBER_CAROL = {
  id: "carol",
  role_id: "engineer",
  display_name: "Carol",
  persona: "\u524D\u7AEF\u5DE5\u7A0B\u5E08\uFF0C\u4E13\u6CE8 React + \u89C6\u89C9\u7EC6\u8282\u3002accessibility \u662F\u9ED8\u8BA4\u5F00\u5173\u3002",
  adapter: "claude-code",
  cli_options_override: {},
  metadata: { primary_languages: ["typescript", "css"], stack: "react" }
};
var MEMBER_DAVE = {
  id: "dave",
  role_id: "reviewer",
  display_name: "Dave",
  persona: "\u4EE3\u7801\u8BC4\u5BA1\u5458\uFF0CPR \u4E00\u5F8B\u6309\u5B89\u5168/\u6027\u80FD/\u53EF\u7EF4\u62A4\u6027\u4E09\u6863\u5206\u7C7B\u3002",
  adapter: "mcode",
  cli_options_override: {},
  metadata: { review_focus: ["security", "performance"] }
};
var MEMBER_EVE = {
  id: "eve",
  role_id: "writer",
  display_name: "Eve",
  persona: "\u6280\u672F\u64B0\u7A3F\u4EBA\uFF0C\u80FD\u628A\u67B6\u6784\u56FE\u7FFB\u8BD1\u6210\u8BFB\u8005\u80FD\u8DDF\u7740\u8DD1\u4E00\u904D\u7684 tutorial\u3002",
  adapter: "claude-code",
  cli_options_override: {},
  metadata: { writing_style: "tutorial", audience: "intermediate-engineers" }
};
var TEMPLATE_DEEP_RESEARCH = {
  id: "deep-research",
  name: "\u6DF1\u5EA6\u8C03\u7814",
  flow: "handoff-round-table",
  flow_config: {
    max_rounds: 3,
    ad_hoc_decision_points: true,
    termination: "all_members_pass_or_max_rounds"
  },
  members: [
    { member_id: "alice", instance_alias: "researcher-1" },
    { member_id: "eve", instance_alias: "writer-1" }
  ]
};
var TEMPLATE_SHIP_FEATURE = {
  id: "ship-feature",
  name: "\u7AEF\u5230\u7AEF\u4EA4\u4ED8\u529F\u80FD",
  flow: "pipeline-with-feedback",
  flow_config: {
    max_rounds: 2,
    feedback_enabled: true,
    stages: ["design", "implement", "review"]
  },
  members: [
    { member_id: "alice", instance_alias: "research" },
    { member_id: "bob", instance_alias: "backend" },
    { member_id: "carol", instance_alias: "frontend" },
    { member_id: "dave", instance_alias: "review" }
  ]
};
var TEMPLATE_FAN_OUT_COLLECT = {
  id: "fan-out-collect",
  name: "\u5E76\u884C\u7814\u7A76 + \u6C47\u603B",
  flow: "fan-out-collect",
  flow_config: {
    parallelism: 3,
    aggregator_id: "eve",
    timeout_ms: 6e5
  },
  members: [
    { member_id: "alice", instance_alias: "researcher-a" },
    { member_id: "alice", instance_alias: "researcher-b" },
    { member_id: "alice", instance_alias: "researcher-c" },
    { member_id: "eve", instance_alias: "aggregator" }
  ]
};
var SAMPLE_ROLES = [ROLE_RESEARCHER, ROLE_ENGINEER, ROLE_REVIEWER, ROLE_WRITER].slice().sort((a, b) => a.id.localeCompare(b.id));
var SAMPLE_MEMBERS = [MEMBER_ALICE, MEMBER_BOB, MEMBER_CAROL, MEMBER_DAVE, MEMBER_EVE].slice().sort((a, b) => a.id.localeCompare(b.id));
var SAMPLE_TEMPLATES = [TEMPLATE_DEEP_RESEARCH, TEMPLATE_SHIP_FEATURE, TEMPLATE_FAN_OUT_COLLECT].slice().sort((a, b) => a.id.localeCompare(b.id));

// ui/team-config-host.js
var PREFIX = "[dsh-team-plugin]";
var LS = {
  roles: "dsh-team-plugin:config:roles",
  members: "dsh-team-plugin:config:members",
  templates: "dsh-team-plugin:config:templates"
};
function readLS(key, fallback) {
  try {
    const raw = globalThis.localStorage?.getItem?.(key);
    if (typeof raw !== "string" || raw.length === 0) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const ok = parsed.filter((x) => x && typeof x === "object" && typeof x.id === "string" && x.id.length > 0);
    return ok.length > 0 || parsed.length === 0 ? ok : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    globalThis.localStorage?.setItem?.(key, JSON.stringify(value));
  } catch {
  }
}
function TeamConfigPanelHost(_props) {
  const React = typeof globalThis !== "undefined" && globalThis.React || void 0;
  const useState = React && typeof React.useState === "function" ? React.useState : null;
  const useEffect = React && typeof React.useEffect === "function" ? React.useEffect : null;
  const initialRoles = useState ? useState(readLS(LS.roles, SAMPLE_ROLES)) : [SAMPLE_ROLES, () => {
  }];
  const initialMembers = useState ? useState(readLS(LS.members, SAMPLE_MEMBERS)) : [SAMPLE_MEMBERS, () => {
  }];
  const initialTemplates = useState ? useState(readLS(LS.templates, SAMPLE_TEMPLATES)) : [SAMPLE_TEMPLATES, () => {
  }];
  const [roles, setRoles] = initialRoles;
  const [members, setMembers] = initialMembers;
  const [templates, setTemplates] = initialTemplates;
  if (useEffect) {
    useEffect(() => {
      writeLS(LS.roles, roles);
    }, [roles]);
    useEffect(() => {
      writeLS(LS.members, members);
    }, [members]);
    useEffect(() => {
      writeLS(LS.templates, templates);
    }, [templates]);
  }
  return createElement(TeamConfigPanel, {
    roles,
    members,
    templates,
    onSubmitRole: (payload) => {
      try {
        console.log(PREFIX, "role form submit:", payload);
      } catch {
      }
      if (payload && typeof payload.id === "string" && payload.id.length > 0) {
        setRoles((prev) => {
          if (prev.some((r) => r && r.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    },
    onSubmitMember: (payload) => {
      try {
        console.log(PREFIX, "member form submit:", payload);
      } catch {
      }
      if (payload && typeof payload.id === "string" && payload.id.length > 0) {
        setMembers((prev) => {
          if (prev.some((m) => m && m.id === payload.id)) return prev;
          if (typeof payload.role_id !== "string" || !roles.some((r) => r && r.id === payload.role_id)) {
            try {
              console.warn(PREFIX, "member form submit: role_id", JSON.stringify(payload.role_id), "not in roles, ignoring");
            } catch {
            }
            return prev;
          }
          return [...prev, payload];
        });
      }
    },
    onSubmitTemplate: (payload) => {
      try {
        console.log(PREFIX, "template form submit:", payload);
      } catch {
      }
      if (payload && typeof payload.id === "string" && payload.id.length > 0) {
        setTemplates((prev) => {
          if (prev.some((t) => t && t.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    },
    onDelete: (kind, id) => {
      try {
        console.log(PREFIX, "delete", kind, "id=" + id);
      } catch {
      }
      if (kind === "role") {
        setRoles((prev) => prev.filter((r) => r && r.id !== id));
      } else if (kind === "member") {
        setMembers((prev) => prev.filter((m) => m && m.id !== id));
      } else if (kind === "template") {
        setTemplates((prev) => prev.filter((t) => t && t.id !== id));
      }
    }
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
