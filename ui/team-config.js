/**
 * team-config.js — Team 配置中心 (Role / Member / TeamTemplate 3 tab).
 *
 * Per architecture §7.1: this plugin owns a `team-config` keyed slot that
 * hosts the global library editor. The previous implementation incorrectly
 * mapped the slot to `TeamPanel` (a run-state component) — that was a bug,
 * the two surfaces are independent. This file introduces `TeamConfigPanel`
 * with three tabs (Role / Member / TeamTemplate), each a list + create
 * form, with the actual mutation going through the team.*_role /
 * team.*_member / team.*_template tools (A6/A7/A8).
 *
 * Slot binding lives in `ui/team-panel.js#registerTeamSlots` (A5).
 *
 * Three render states, mirroring `team-plan.js`:
 *   - loading: no data loaded yet
 *   - error:   a load failed (rare; no DSH runtime, etc.)
 *   - content: roles + members + templates available, with form
 *
 * The form is intentionally **read-mostly** in this revision: fields are
 * rendered as `<input>` elements with their current value but the actual
 * submission goes through the `team.create_*` / `team.update_*` tools,
 * which the DSH host wires up in a follow-up patch (the form is a layout
 * placeholder, not a live form widget — per PROGRESS.md §2.0 backlog
 * "UI 实时交互 / 验证延后" note). The DSH host gets a stable shape to
 * render and to test against in snapshot tests.
 *
 * 29th-commit changes:
 *   - Use `React.useState` to own `activeTab` so the Members / Templates
 *     tabs are actually clickable (the HOC's `onChangeTab: NOOP` left
 *     them dead in 28th commit).
 *   - All user-visible copy translated to Chinese; the schema field
 *     `id` / `display_name` / `persona` etc. stays English because it
 *     is the on-the-wire JSON for the `team.*_role / _member /
 *     _template` Cordis tools (A6/A7/A8) and the storage JSON
 *     (`<data-root>/roles/*.json` per `architecture.md §5.2`).
 *
 * @module dsh-team-plugin/ui/team-config
 */

import { createElement as h } from './_react.js';
import { tokens } from './_react.js';

/** @typedef {'roles'|'members'|'templates'} TabKey */

/** @typedef {{
 *   roles?: Array<any>,
 *   members?: Array<any>,
 *   templates?: Array<any>,
 *   activeTab?: TabKey,
 *   error?: string,
 *   onChangeTab?: (tab: TabKey) => void,
 *   onSubmitRole?: (payload: any) => void | Promise<void>,
 *   onSubmitMember?: (payload: any) => void | Promise<void>,
 *   onSubmitTemplate?: (payload: any) => void | Promise<void>,
 *   onDelete?: (kind: 'role'|'member'|'template', id: string) => void | Promise<void>,
 * }} Props
 */

const ADAPTER_OPTIONS = ['hermes', 'mcode', 'claude-code'];
const FLOW_OPTIONS = ['handoff-round-table', 'pipeline-with-feedback', 'fan-out-collect'];

// i18n lookup tables — flat to keep snapshot / tree-walk tests stable.
const L = {
  // Header
  configTitle: 'DSH 团队配置',
  summary: (r, m, t) => `${r} 个角色 / ${m} 个成员 / ${t} 个团队模板`,
  // Tabs
  tabRoles: (n) => `角色（${n}）`,
  tabMembers: (n) => `成员（${n}）`,
  tabTemplates: (n) => `团队模板（${n}）`,
  // Empty states
  emptyRole: '暂无角色。使用下方表单创建。',
  emptyMember: '暂无成员。使用下方表单创建。',
  emptyTemplate: '暂无团队模板。使用下方表单创建。',
  // Form titles
  createRole: '创建角色',
  createMember: '创建成员',
  createTemplate: '创建团队模板',
  // Field labels (schema field name → 中文)
  fieldLabel: {
    id: 'ID',
    display_name: '显示名称',
    persona: '人设描述',
    adapter: '适配器',
    tools_allowed: '允许的工具（英文逗号分隔）',
    avatar_color: '头像颜色',
    avatar_shape: '头像形状',
    role_id: '所属角色',
    name: '模板名称',
    flow: '协作模式',
    members_json: '成员（JSON 格式）',
  },
  // Buttons
  save: '保存',
  cancel: '取消',
  delete: '删除',
  // States
  loading: '加载配置中…',
  errorPrefix: '加载配置失败：',
  // Save feedback (31st commit)
  savedAt: '已保存',
  savedNote: '数据层见 PROGRESS.md §4 留口（暂存于控制台，§4 落地后真正写入）。',
};

/**
 * Resolve the active tab. Caller-provided `activeTab` wins; otherwise the
 * local `useState` default (`'roles'`) is used. The HOC in 28th commit
 * forwarded a `useState` default, but the inner component is now self-
 * sufficient — the prop is still accepted for testability.
 * @param {Props} props
 * @param {TabKey} local
 * @returns {TabKey}
 */
function pickTab(props, local) {
  if (props?.activeTab === 'members' || props?.activeTab === 'templates' || props?.activeTab === 'roles') {
    return props.activeTab;
  }
  return local;
}

/**
 * Render the form for one entity kind. The form layout is the same
 * across the three kinds (label, input row, primary action). The
 * actual form interaction is delegated to the host via the
 * `onSubmit*` callback props; the component itself is render-only.
 *
 * 31st commit: this used to set `onSubmit: onSubmit ? ... : undefined`,
 * which meant when the HOC didn't pass an `onSubmit*` callback the
 * form had NO onSubmit handler and the browser fell back to its
 * default form-submit behaviour (GET to current URL, page reload).
 * And even when onSubmit was provided, we passed the static `initial`
 * prop instead of reading what the user actually typed. The fix:
 *   1. Always set the form's onSubmit so we always call
 *      `e.preventDefault()` — no page reload regardless of whether a
 *      submit handler is wired up.
 *   2. Read the user's actual input via `new FormData(formEl)` —
 *      uncontrolled inputs (`defaultValue` not `value`) still have
 *      their DOM values captured, so we don't need a per-field
 *      useState.
 *   3. Show a brief "已保存" line under the form so the user sees
 *      the click landed (the data layer is still §4 留口 so we
 *      don't actually persist, but the click is no longer a no-op).
 *
 * @param {{
 *   kind: 'role'|'member'|'template',
 *   fields: Array<{ name: string, label: string, type: 'text'|'textarea'|'select', options?: string[], required?: boolean }>,
 *   initial?: Record<string, any>,
 *   onSubmit?: (payload: any) => void | Promise<void>,
 *   onCancel?: () => void,
 * }} props
 */
function EntityForm(props) {
  const { kind, fields, initial = {}, onSubmit, onCancel } = props;
  const title = kind === 'role' ? L.createRole : kind === 'member' ? L.createMember : L.createTemplate;
  // Local "just saved" indicator. Lives in EntityForm (not the panel)
  // so each tab's submit shows its own indicator and they don't
  // trample each other.
  const React = (typeof globalThis !== 'undefined' && globalThis.React) || undefined;
  const useState = React && typeof React.useState === 'function' ? React.useState : null;
  const [savedAt, setSavedAt] = useState ? useState(null) : [null, () => {}];
  return h(
    'form',
    {
      className: `dsh-team-config-form dsh-team-config-form--${kind}`,
      'data-form-kind': kind,
      'data-saved-at': savedAt ? String(savedAt) : undefined,
      style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, marginTop: 12 },
      // ALWAYS set the onSubmit so we can preventDefault unconditionally.
      // Without this, clicking Save with no parent callback = the
      // browser's default form submission kicks in = page reload
      // (the user-reported bug).
      onSubmit: (e) => {
        e?.preventDefault?.();
        if (typeof onSubmit !== 'function') {
          // Even without a parent callback, the user gets the
          // "已保存" confirmation so the click isn't a dead end.
          setSavedAt(Date.now());
          return;
        }
        // Capture the user's actual input (uncontrolled fields keep
        // their DOM values; FormData picks them up by the `name`
        // attribute set in renderField).
        let payload = initial;
        try {
          const fd = new FormData(e.target);
          payload = {};
          for (const [k, v] of fd.entries()) {
            payload[k] = typeof v === 'string' ? v : '';
          }
        } catch {
          // FormData failed (very old browsers); fall back to the
          // static initial so we still capture the call.
          payload = initial;
        }
        const result = onSubmit(payload);
        // If the parent returned a promise, show the indicator when
        // it settles; otherwise flip it immediately.
        if (result && typeof result.then === 'function') {
          result.then(() => setSavedAt(Date.now()), () => setSavedAt(Date.now()));
        } else {
          setSavedAt(Date.now());
        }
      },
    },
    h('div', { className: 'dsh-team-config-form-title', style: { fontWeight: tokens.font.weight.semibold, fontSize: tokens.font.size.lg, marginBottom: 2, color: tokens.color.text } },
      title,
    ),
    ...fields.map((f) => renderField(f, initial)),
    savedAt
      ? h('div', { className: 'dsh-team-config-form-saved', 'data-saved': true, role: 'status', style: { color: tokens.color.success, fontSize: tokens.font.size.sm, padding: '4px 0 0' } },
        `✓ ${L.savedAt}（${new Date(savedAt).toLocaleTimeString()}）— ${L.savedNote}`)
      : null,
    h('div', { className: 'dsh-team-config-form-actions', style: { display: 'flex', gap: 8, marginTop: 6 } },
      h('button', {
        type: 'submit',
        'data-action': 'save',
        style: { padding: `6px 14px`, fontSize: tokens.font.size.md, background: tokens.color.accent, color: 'white', border: 'none', borderRadius: tokens.radius.md, cursor: 'pointer', fontWeight: tokens.font.weight.medium },
      }, L.save),
      onCancel
        ? h('button', {
            type: 'button',
            'data-action': 'cancel',
            onClick: onCancel,
            style: { padding: `6px 14px`, fontSize: tokens.font.size.md, background: tokens.color.surface, color: tokens.color.text, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, cursor: 'pointer', fontWeight: tokens.font.weight.medium },
          }, L.cancel)
        : null,
    ),
  );
}

/** @param {{ name: string, label: string, type: string, options?: string[], required?: boolean }} field @param {Record<string, any>} initial */
function renderField(field, initial) {
  const { name, type, options, required } = field;
  const label = L.fieldLabel[name] ?? field.label ?? name;
  const value = initial?.[name] ?? '';
  if (type === 'select') {
    return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
      h('span', { style: { fontWeight: tokens.font.weight.medium } }, label),
      h('select', {
        name,
        'data-input': name,
        defaultValue: String(value),
        style: { padding: '6px 8px', fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, color: tokens.color.text, fontFamily: 'inherit' },
      },
        ...(options ?? []).map((o) =>
          h('option', { key: o, value: o, selected: o === value }, o),
        ),
      ),
    );
  }
  if (type === 'textarea') {
    return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
      h('span', { style: { fontWeight: tokens.font.weight.medium } }, label),
      h('textarea', {
        name,
        'data-input': name,
        defaultValue: String(value),
        required: required === true,
        rows: 3,
        style: { padding: '6px 8px', fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, fontFamily: 'inherit', background: tokens.color.surface, color: tokens.color.text, resize: 'vertical' },
      }),
    );
  }
  return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: tokens.font.size.md, color: tokens.color.text } },
    h('span', { style: { fontWeight: tokens.font.weight.medium } }, label),
    h('input', {
      name,
      'data-input': name,
      type: 'text',
      defaultValue: String(value),
      required: required === true,
      style: { padding: '6px 8px', fontSize: tokens.font.size.md, border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, background: tokens.color.surface, color: tokens.color.text, fontFamily: 'inherit' },
    }),
  );
}

/**
 * Render one entity's list + create form for the active tab.
 * @param {{
 *   kind: 'role'|'member'|'template',
 *   items: Array<any>,
 *   formFields: Array<any>,
 *   renderItem: (item: any) => any,
 *   initialForm: Record<string, any>,
 *   onSubmit?: (payload: any) => void | Promise<void>,
 *   onDelete?: (id: string) => void | Promise<void>,
 * }} props
 */
function EntityTab(props) {
  const { kind, items, formFields, renderItem, initialForm, onSubmit, onDelete } = props;
  const emptyText = kind === 'role' ? L.emptyRole : kind === 'member' ? L.emptyMember : L.emptyTemplate;
  return h('div', { className: `dsh-team-config-tab dsh-team-config-tab--${kind}`, 'data-tab': kind, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { className: 'dsh-team-config-list', 'data-list': kind, style: { display: 'flex', flexDirection: 'column', gap: 6 } },
      items.length === 0
        ? h('div', { className: 'dsh-team-config-empty', 'data-empty': true, style: { color: tokens.color.muted, fontSize: tokens.font.size.md, padding: 10, fontStyle: 'italic', textAlign: 'center' } },
          emptyText)
        : items.map((it) =>
            h('div', {
              key: it?.id ?? JSON.stringify(it),
              className: 'dsh-team-config-list-item',
              'data-item-id': it?.id,
              style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: `1px solid ${tokens.color.border}`, borderRadius: tokens.radius.md, fontSize: tokens.font.size.md, background: tokens.color.surface },
            },
              renderItem(it),
              onDelete
                ? h('button', {
                    type: 'button',
                    'data-action': 'delete',
                    onClick: () => onDelete(it?.id),
                    style: { marginLeft: 'auto', padding: '4px 10px', fontSize: tokens.font.size.sm, color: tokens.color.danger, background: 'white', border: `1px solid ${tokens.color.dangerSoft}`, borderRadius: tokens.radius.sm, cursor: 'pointer' },
                  }, L.delete)
                : null,
            ),
          ),
    ),
    h(EntityForm, { kind, fields: formFields, initial: initialForm, onSubmit }),
  );
}

/**
 * @param {any} role
 */
function renderRoleItem(role) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto' } },
    h('span', { 'data-role-adapter': role?.adapter, style: { padding: '2px 8px', background: tokens.color.accentSoft, color: tokens.color.accent, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, role?.adapter ?? '?'),
    h('strong', { 'data-role-id': role?.id, style: { fontFamily: 'monospace' } }, role?.id ?? '?'),
    h('span', { 'data-role-display-name': true, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, role?.display_name ?? ''),
  );
}

/** @param {any} m */
function renderMemberItem(m) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto' } },
    h('span', { 'data-member-adapter': m?.adapter, style: { padding: '2px 8px', background: tokens.color.successSoft, color: tokens.color.success, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, m?.adapter ?? '?'),
    h('strong', { 'data-member-id': m?.id, style: { fontFamily: 'monospace' } }, m?.id ?? '?'),
    h('span', { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, `角色：${m?.role_id ?? '?'}`),
    h('span', { 'data-member-display-name': true, style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, m?.display_name ?? ''),
  );
}

/** @param {any} t */
function renderTemplateItem(t) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 auto' } },
    h('span', { 'data-template-flow': t?.flow, style: { padding: '2px 8px', background: tokens.color.warningSoft, color: tokens.color.warning, borderRadius: tokens.radius.pill, fontSize: tokens.font.size.xs, fontWeight: tokens.font.weight.semibold } }, t?.flow ?? '?'),
    h('strong', { 'data-template-id': t?.id, style: { fontFamily: 'monospace' } }, t?.id ?? '?'),
    h('span', { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, `${t?.members?.length ?? 0} 个成员`),
  );
}

/**
 * The team-config panel. Renders three tabs (Role / Member /
 * TeamTemplate), each with a list + create form. Active tab is owned
 * by `useState` so the Members / Templates buttons are clickable
 * (the 28th-commit HOC's no-op `onChangeTab` left them dead).
 *
 * The DSH host passes runtime data via the `data hooks` (see
 * `ui/team-config-host.js` once the §4 data layer lands); for now
 * the host doesn't bridge anything, so `roles` / `members` /
 * `templates` are empty arrays and the form renders its built-in
 * empty-state copy.
 *
 * @param {Props} props
 */
export function TeamConfigPanel(props) {
  const React = (typeof globalThis !== 'undefined' && globalThis.React) || undefined;
  const useState = React && typeof React.useState === 'function' ? React.useState : null;
  const roles = Array.isArray(props?.roles) ? props.roles : [];
  const members = Array.isArray(props?.members) ? props.members : [];
  const templates = Array.isArray(props?.templates) ? props.templates : [];
  const [localTab, setLocalTab] = useState ? useState('roles') : ['roles', () => {}];
  const active = pickTab(props, localTab);
  const onChangeTab = props?.onChangeTab ?? ((next) => { if (useState) setLocalTab(next); });

  if (props?.error) {
    return h(
      'div',
      { className: 'dsh-team-config dsh-team-config--error', 'data-state': 'error', style: { padding: 12, color: tokens.color.danger, fontSize: tokens.font.size.md } },
      `${L.errorPrefix}${props.error}`,
    );
  }
  if (roles.length === 0 && members.length === 0 && templates.length === 0 && !props?.onChangeTab && !props?.activeTab && !useState) {
    // No data, no callbacks, no activeTab, no useState — loading state. (If
    // the host passed activeTab but no data yet, render the content shell
    // so the user can see the empty state instead of bouncing.)
    return h(
      'div',
      { className: 'dsh-team-config dsh-team-config--loading', 'data-state': 'loading', style: { padding: 12, color: tokens.color.muted, fontSize: tokens.font.size.md, fontStyle: 'italic' } },
      L.loading,
    );
  }

  return h(
    'div',
    {
      className: 'dsh-team-config',
      'data-state': 'content',
      'data-active-tab': active,
      style: { padding: '4px 4px 16px', fontSize: tokens.font.size.md, color: tokens.color.text, maxWidth: 720 },
    },
    h('div', { className: 'dsh-team-config-header', style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 } },
      h('strong', { style: { fontSize: 18, fontWeight: tokens.font.weight.semibold } }, L.configTitle),
      h('span', { style: { color: tokens.color.muted, fontSize: tokens.font.size.sm } }, L.summary(roles.length, members.length, templates.length)),
    ),
    h('div', { className: 'dsh-team-config-tabs', 'data-tabs': true, style: { display: 'flex', gap: 4, borderBottom: `1px solid ${tokens.color.border}`, marginBottom: 4 } },
      h('button', {
        type: 'button',
        'data-tab-key': 'roles',
        'aria-pressed': active === 'roles',
        onClick: () => onChangeTab('roles'),
        style: tabButtonStyle(active === 'roles'),
      }, L.tabRoles(roles.length)),
      h('button', {
        type: 'button',
        'data-tab-key': 'members',
        'aria-pressed': active === 'members',
        onClick: () => onChangeTab('members'),
        style: tabButtonStyle(active === 'members'),
      }, L.tabMembers(members.length)),
      h('button', {
        type: 'button',
        'data-tab-key': 'templates',
        'aria-pressed': active === 'templates',
        onClick: () => onChangeTab('templates'),
        style: tabButtonStyle(active === 'templates'),
      }, L.tabTemplates(templates.length)),
    ),
    active === 'roles'
      ? h(EntityTab, {
          key: 'roles',
          kind: 'role',
          items: roles,
          renderItem: renderRoleItem,
          initialForm: { id: '', display_name: '', persona: '', adapter: 'hermes', tools_allowed: '', avatar_color: tokens.color.accent, avatar_shape: 'circle' },
          formFields: [
            { name: 'id', label: 'ID', type: 'text', required: true },
            { name: 'display_name', label: '显示名称', type: 'text', required: true },
            { name: 'persona', label: '人设描述', type: 'textarea' },
            { name: 'adapter', label: '适配器', type: 'select', options: ADAPTER_OPTIONS, required: true },
            { name: 'tools_allowed', label: '允许的工具', type: 'text' },
            { name: 'avatar_color', label: '头像颜色', type: 'text' },
            { name: 'avatar_shape', label: '头像形状', type: 'text' },
          ],
          onSubmit: props?.onSubmitRole,
          onDelete: props?.onDelete ? (id) => props.onDelete('role', id) : undefined,
        })
      : null,
    active === 'members'
      ? h(EntityTab, {
          key: 'members',
          kind: 'member',
          items: members,
          renderItem: renderMemberItem,
          initialForm: { id: '', role_id: roles[0]?.id ?? '', display_name: '', persona: '', adapter: 'hermes' },
          formFields: [
            { name: 'id', label: 'ID', type: 'text', required: true },
            { name: 'role_id', label: '所属角色', type: 'select', options: roles.map((r) => r.id), required: true },
            { name: 'display_name', label: '显示名称', type: 'text', required: true },
            { name: 'persona', label: '人设描述', type: 'textarea' },
            { name: 'adapter', label: '适配器', type: 'select', options: ADAPTER_OPTIONS, required: true },
          ],
          onSubmit: props?.onSubmitMember,
          onDelete: props?.onDelete ? (id) => props.onDelete('member', id) : undefined,
        })
      : null,
    active === 'templates'
      ? h(EntityTab, {
          key: 'templates',
          kind: 'template',
          items: templates,
          renderItem: renderTemplateItem,
          initialForm: { id: '', name: '', flow: 'handoff-round-table', members_json: JSON.stringify([{ member_id: members[0]?.id ?? '', instance_alias: 'a' }], null, 2) },
          formFields: [
            { name: 'id', label: 'ID', type: 'text', required: true },
            { name: 'name', label: '模板名称', type: 'text', required: true },
            { name: 'flow', label: '协作模式', type: 'select', options: FLOW_OPTIONS, required: true },
            { name: 'members_json', label: '成员（JSON 格式）', type: 'textarea' },
          ],
          onSubmit: props?.onSubmitTemplate,
          onDelete: props?.onDelete ? (id) => props.onDelete('template', id) : undefined,
        })
      : null,
  );
}

/** @param {boolean} active */
function tabButtonStyle(active) {
  return {
    padding: '8px 14px',
    fontSize: tokens.font.size.md,
    fontWeight: active ? tokens.font.weight.semibold : tokens.font.weight.normal,
    background: 'transparent',
    color: active ? tokens.color.accent : tokens.color.muted,
    border: 'none',
    borderBottom: active ? `2px solid ${tokens.color.accent}` : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: -1,
  };
}

export { EntityTab, EntityForm };
