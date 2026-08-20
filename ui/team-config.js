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
 * @module dsh-team-plugin/ui/team-config
 */

import { createElement as h } from './_react.js';

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

/**
 * Resolve a default tab key. The DSH host passes `activeTab`; for
 * unhosted / fallback renders we default to 'roles'.
 * @param {Props} props
 * @returns {TabKey}
 */
function pickTab(props) {
  const t = props?.activeTab;
  return t === 'members' || t === 'templates' ? t : 'roles';
}

/**
 * Render the form for one entity kind. The form layout is the same
 * across the three kinds (label, input row, primary action). The
 * actual form interaction is delegated to the host via the
 * `onSubmit*` callback props; the component itself is render-only.
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
  return h(
    'form',
    {
      className: `dsh-team-config-form dsh-team-config-form--${kind}`,
      'data-form-kind': kind,
      style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fafafa' },
      onSubmit: onSubmit ? (e) => { e?.preventDefault?.(); onSubmit(initial); } : undefined,
    },
    h('div', { className: 'dsh-team-config-form-title', style: { fontWeight: 600, fontSize: 13, marginBottom: 4 } },
      initial?.id ? `Edit ${kind} "${initial.id}"` : `Create ${kind}`,
    ),
    ...fields.map((f) => renderField(f, initial)),
    h('div', { className: 'dsh-team-config-form-actions', style: { display: 'flex', gap: 6, marginTop: 4 } },
      h('button', {
        type: 'submit',
        'data-action': 'save',
        style: { padding: '4px 12px', fontSize: 12, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' },
      }, 'Save'),
      onCancel
        ? h('button', {
            type: 'button',
            'data-action': 'cancel',
            onClick: onCancel,
            style: { padding: '4px 12px', fontSize: 12, background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' },
          }, 'Cancel')
        : null,
    ),
  );
}

/** @param {{ name: string, label: string, type: string, options?: string[], required?: boolean }} field @param {Record<string, any>} initial */
function renderField(field, initial) {
  const { name, label, type, options, required } = field;
  const value = initial?.[name] ?? '';
  if (type === 'select') {
    return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: '#374151' } },
      h('span', null, label),
      h('select', {
        name,
        'data-input': name,
        defaultValue: String(value),
        style: { padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 },
      },
        ...(options ?? []).map((o) =>
          h('option', { key: o, value: o, selected: o === value }, o),
        ),
      ),
    );
  }
  if (type === 'textarea') {
    return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: '#374151' } },
      h('span', null, label),
      h('textarea', {
        name,
        'data-input': name,
        defaultValue: String(value),
        required: required === true,
        rows: 3,
        style: { padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, fontFamily: 'inherit' },
      }),
    );
  }
  return h('label', { key: name, 'data-field': name, style: { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11, color: '#374151' } },
    h('span', null, label),
    h('input', {
      name,
      'data-input': name,
      type: 'text',
      defaultValue: String(value),
      required: required === true,
      style: { padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4 },
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
  return h('div', { className: `dsh-team-config-tab dsh-team-config-tab--${kind}`, 'data-tab': kind, style: { display: 'flex', flexDirection: 'column', gap: 12 } },
    h('div', { className: 'dsh-team-config-list', 'data-list': kind, style: { display: 'flex', flexDirection: 'column', gap: 4 } },
      items.length === 0
        ? h('div', { className: 'dsh-team-config-empty', 'data-empty': true, style: { color: '#6b7280', fontSize: 12, padding: 8 } },
          `No ${kind} yet. Use the form below to create one.`)
        : items.map((it) =>
            h('div', {
              key: it?.id ?? JSON.stringify(it),
              className: 'dsh-team-config-list-item',
              'data-item-id': it?.id,
              style: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', border: '1px solid #e5e7eb', borderRadius: 4, fontSize: 12 },
            },
              renderItem(it),
              onDelete
                ? h('button', {
                    type: 'button',
                    'data-action': 'delete',
                    onClick: () => onDelete(it?.id),
                    style: { marginLeft: 'auto', padding: '2px 8px', fontSize: 11, color: '#b91c1c', background: 'white', border: '1px solid #fecaca', borderRadius: 3, cursor: 'pointer' },
                  }, 'Delete')
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
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto' } },
    h('span', { 'data-role-adapter': role?.adapter, style: { padding: '1px 6px', background: '#dbeafe', color: '#1e40af', borderRadius: 8, fontSize: 10, fontWeight: 600 } }, role?.adapter ?? '?'),
    h('strong', { 'data-role-id': role?.id }, role?.id ?? '?'),
    h('span', { 'data-role-display-name': true, style: { color: '#6b7280', fontSize: 11 } }, role?.display_name ?? ''),
  );
}

/** @param {any} m */
function renderMemberItem(m) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto' } },
    h('span', { 'data-member-adapter': m?.adapter, style: { padding: '1px 6px', background: '#dcfce7', color: '#166534', borderRadius: 8, fontSize: 10, fontWeight: 600 } }, m?.adapter ?? '?'),
    h('strong', { 'data-member-id': m?.id }, m?.id ?? '?'),
    h('span', { style: { color: '#6b7280', fontSize: 11 } }, `role: ${m?.role_id ?? '?'}`),
    h('span', { 'data-member-display-name': true, style: { color: '#6b7280', fontSize: 11 } }, m?.display_name ?? ''),
  );
}

/** @param {any} t */
function renderTemplateItem(t) {
  return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto' } },
    h('span', { 'data-template-flow': t?.flow, style: { padding: '1px 6px', background: '#fef3c7', color: '#854d0e', borderRadius: 8, fontSize: 10, fontWeight: 600 } }, t?.flow ?? '?'),
    h('strong', { 'data-template-id': t?.id }, t?.id ?? '?'),
    h('span', { style: { color: '#6b7280', fontSize: 11 } }, `${t?.members?.length ?? 0} member(s)`),
  );
}

/**
 * The team-config panel. Renders three tabs (Role / Member /
 * TeamTemplate), each with a list + create form. The host passes the
 * data via props (resolved from the services in its React useEffect).
 * In tests, the host is the smoke-test harness; in production, it's
 * the DSH host's React tree.
 *
 * @param {Props} props
 */
export function TeamConfigPanel(props) {
  const roles = Array.isArray(props?.roles) ? props.roles : [];
  const members = Array.isArray(props?.members) ? props.members : [];
  const templates = Array.isArray(props?.templates) ? props.templates : [];
  const active = pickTab(props);

  if (props?.error) {
    return h(
      'div',
      { className: 'dsh-team-config dsh-team-config--error', 'data-state': 'error', style: { padding: 12, color: '#b91c1c', fontSize: 12 } },
      `Failed to load configuration: ${props.error}`,
    );
  }
  if (roles.length === 0 && members.length === 0 && templates.length === 0 && !props?.onChangeTab && !props?.activeTab) {
    // No data, no callbacks, no activeTab — loading state. (If the
    // host passed activeTab but no data yet, render the content shell
    // so the user can see the empty state instead of bouncing.)
    return h(
      'div',
      { className: 'dsh-team-config dsh-team-config--loading', 'data-state': 'loading', style: { padding: 12, color: '#6b7280', fontSize: 12, fontStyle: 'italic' } },
      'Loading configuration\u2026',
    );
  }

  return h(
    'div',
    {
      className: 'dsh-team-config',
      'data-state': 'content',
      'data-active-tab': active,
      style: { padding: 12, fontSize: 13, color: '#111827' },
    },
    h('div', { className: 'dsh-team-config-header', style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 } },
      h('strong', { style: { fontSize: 15 } }, 'DSH Team Configuration'),
      h('span', { style: { color: '#6b7280', fontSize: 11 } }, `${roles.length} role(s) / ${members.length} member(s) / ${templates.length} template(s)`),
    ),
    h('div', { className: 'dsh-team-config-tabs', 'data-tabs': true, style: { display: 'flex', gap: 4, borderBottom: '1px solid #e5e7eb', marginBottom: 12 } },
      h('button', {
        type: 'button',
        'data-tab-key': 'roles',
        'aria-pressed': active === 'roles',
        onClick: props?.onChangeTab ? () => props.onChangeTab('roles') : undefined,
        style: tabButtonStyle(active === 'roles'),
      }, `Roles (${roles.length})`),
      h('button', {
        type: 'button',
        'data-tab-key': 'members',
        'aria-pressed': active === 'members',
        onClick: props?.onChangeTab ? () => props.onChangeTab('members') : undefined,
        style: tabButtonStyle(active === 'members'),
      }, `Members (${members.length})`),
      h('button', {
        type: 'button',
        'data-tab-key': 'templates',
        'aria-pressed': active === 'templates',
        onClick: props?.onChangeTab ? () => props.onChangeTab('templates') : undefined,
        style: tabButtonStyle(active === 'templates'),
      }, `Templates (${templates.length})`),
    ),
    active === 'roles'
      ? h(EntityTab, {
          key: 'roles',
          kind: 'role',
          items: roles,
          renderItem: renderRoleItem,
          initialForm: { id: '', display_name: '', persona: '', adapter: 'hermes', tools_allowed: '', avatar_color: '#3b82f6', avatar_shape: 'circle' },
          formFields: [
            { name: 'id', label: 'ID', type: 'text', required: true },
            { name: 'display_name', label: 'Display Name', type: 'text', required: true },
            { name: 'persona', label: 'Persona', type: 'textarea' },
            { name: 'adapter', label: 'Adapter', type: 'select', options: ADAPTER_OPTIONS, required: true },
            { name: 'tools_allowed', label: 'Tools Allowed (comma-sep)', type: 'text' },
            { name: 'avatar_color', label: 'Avatar Color', type: 'text' },
            { name: 'avatar_shape', label: 'Avatar Shape', type: 'text' },
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
            { name: 'role_id', label: 'Role', type: 'select', options: roles.map((r) => r.id), required: true },
            { name: 'display_name', label: 'Display Name', type: 'text', required: true },
            { name: 'persona', label: 'Persona', type: 'textarea' },
            { name: 'adapter', label: 'Adapter', type: 'select', options: ADAPTER_OPTIONS, required: true },
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
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'flow', label: 'Flow', type: 'select', options: FLOW_OPTIONS, required: true },
            { name: 'members_json', label: 'Members (JSON)', type: 'textarea' },
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
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    background: 'transparent',
    color: active ? '#1e40af' : '#6b7280',
    border: 'none',
    borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    cursor: 'pointer',
    marginBottom: -1,
  };
}

export { EntityTab, EntityForm };
