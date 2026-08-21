/**
 * sample-data.js — build-time embed of demo roles / members / templates.
 *
 * Why this file exists (30th commit): the DSH client cannot reach the
 * host-side `<DSH_HOME>/team-assets/{roles,members,team-templates}/`
 * JSON files (no typed RPC, no `host.call` generic dispatcher, no
 * file-read RPC — see `PROGRESS.md §4 留口`). To make the form
 * testable in the browser, this module exports 4 roles + 5 members +
 * 3 templates as plain JS objects; esbuild inlines them into
 * `lib/client.js` via static `import` so no extra fetch happens.
 *
 * When the §4 data layer lands, `ui/team-config-host.js#TeamConfigPanelHost`
 * will read the same shape from a `settingsScope` snapshot (or a typed
 * RPC) and pass it down to `TeamConfigPanel`; this file stays as a
 * graceful fallback (no-data-while-loading) and as the source of demo
 * data for offline tests.
 *
 * The schema mirrors what `services/{role,member,team-template}-service.js`
 * validate on disk: id, display_name, persona, adapter, cli_options,
 * tools_allowed, avatar for roles; id, role_id, display_name, persona,
 * adapter, cli_options_override, metadata for members; id, name, flow,
 * flow_config, members[] for templates. The on-disk `services/*-service.js`
 * `create()` / `update()` accept the same shape, so what you see in
 * the form matches what the host `team.*` tools can write.
 */

// ---------- Roles ----------

/** @type {import('./_react.js').any} */
export const ROLE_RESEARCHER = {
  id: 'researcher',
  display_name: '研究员',
  persona: '你是一位严谨的研究员。任务来了先拆解成 3-5 个子问题，再决定每个子问题用 web 搜索、读本地文件、还是问上游。结论必须有引用支撑，不能凭印象下判断。',
  adapter: 'hermes',
  cli_options: {},
  tools_allowed: ['web_search', 'web_fetch', 'read', 'write'],
  avatar: { color: '#3b82f6', shape: 'circle' },
};

/** @type {import('./_react.js').any} */
export const ROLE_ENGINEER = {
  id: 'engineer',
  display_name: '工程师',
  persona: '你是一位能落地的工程师。接到需求先想清楚接口和边界条件，写代码前先列 plan。改完自己跑测试/构建验证，不要甩锅。出错时附完整 stacktrace 和你尝试过的修复。',
  adapter: 'hermes',
  cli_options: {},
  tools_allowed: ['read', 'write', 'edit', 'bash', 'grep', 'glob'],
  avatar: { color: '#22c55e', shape: 'square' },
};

/** @type {import('./_react.js').any} */
export const ROLE_REVIEWER = {
  id: 'reviewer',
  display_name: '评审员',
  persona: '你是一位挑剔但建设性的评审员。看到代码先找风险：边界条件、并发、错误处理、依赖隐患。给反馈时按「必须改 / 建议改 / 锦上添花」三档标，不要夹带个人偏好。',
  adapter: 'mcode',
  cli_options: {},
  tools_allowed: ['read', 'grep', 'glob'],
  avatar: { color: '#f97316', shape: 'triangle' },
};

/** @type {import('./_react.js').any} */
export const ROLE_WRITER = {
  id: 'writer',
  display_name: '撰稿人',
  persona: '你是一位清晰的撰稿人。先列大纲再动笔，技术术语第一次出现时用一句话解释。改稿时先问自己：读者读到这里会不会卡？',
  adapter: 'claude-code',
  cli_options: {},
  tools_allowed: ['read', 'write', 'web_search'],
  avatar: { color: '#a855f7', shape: 'circle' },
};

// ---------- Members ----------

/** @type {import('./_react.js').any} */
export const MEMBER_ALICE = {
  id: 'alice',
  role_id: 'researcher',
  display_name: 'Alice',
  persona: '前 5 分钟先做技术调研，引用至少 3 个来源，列出关键事实和分歧。',
  adapter: 'hermes',
  cli_options_override: {},
  metadata: { timezone: 'Asia/Shanghai', language: 'zh-CN' },
};

/** @type {import('./_react.js').any} */
export const MEMBER_BOB = {
  id: 'bob',
  role_id: 'engineer',
  display_name: 'Bob',
  persona: '后端工程师，习惯在写代码前先画状态机和边界。Go/Rust/TypeScript 都行。',
  adapter: 'hermes',
  cli_options_override: {},
  metadata: { primary_languages: ['typescript', 'go'], seniority: 'senior' },
};

/** @type {import('./_react.js').any} */
export const MEMBER_CAROL = {
  id: 'carol',
  role_id: 'engineer',
  display_name: 'Carol',
  persona: '前端工程师，专注 React + 视觉细节。accessibility 是默认开关。',
  adapter: 'claude-code',
  cli_options_override: {},
  metadata: { primary_languages: ['typescript', 'css'], stack: 'react' },
};

/** @type {import('./_react.js').any} */
export const MEMBER_DAVE = {
  id: 'dave',
  role_id: 'reviewer',
  display_name: 'Dave',
  persona: '代码评审员，PR 一律按安全/性能/可维护性三档分类。',
  adapter: 'mcode',
  cli_options_override: {},
  metadata: { review_focus: ['security', 'performance'] },
};

/** @type {import('./_react.js').any} */
export const MEMBER_EVE = {
  id: 'eve',
  role_id: 'writer',
  display_name: 'Eve',
  persona: '技术撰稿人，能把架构图翻译成读者能跟着跑一遍的 tutorial。',
  adapter: 'claude-code',
  cli_options_override: {},
  metadata: { writing_style: 'tutorial', audience: 'intermediate-engineers' },
};

// ---------- Templates ----------

/** @type {import('./_react.js').any} */
export const TEMPLATE_DEEP_RESEARCH = {
  id: 'deep-research',
  name: '深度调研',
  flow: 'handoff-round-table',
  flow_config: {
    max_rounds: 3,
    ad_hoc_decision_points: true,
    termination: 'all_members_pass_or_max_rounds',
  },
  members: [
    { member_id: 'alice', instance_alias: 'researcher-1' },
    { member_id: 'eve', instance_alias: 'writer-1' },
  ],
};

/** @type {import('./_react.js').any} */
export const TEMPLATE_SHIP_FEATURE = {
  id: 'ship-feature',
  name: '端到端交付功能',
  flow: 'pipeline-with-feedback',
  flow_config: {
    max_rounds: 2,
    feedback_enabled: true,
    stages: ['design', 'implement', 'review'],
  },
  members: [
    { member_id: 'alice', instance_alias: 'research' },
    { member_id: 'bob', instance_alias: 'backend' },
    { member_id: 'carol', instance_alias: 'frontend' },
    { member_id: 'dave', instance_alias: 'review' },
  ],
};

/** @type {import('./_react.js').any} */
export const TEMPLATE_FAN_OUT_COLLECT = {
  id: 'fan-out-collect',
  name: '并行研究 + 汇总',
  flow: 'fan-out-collect',
  flow_config: {
    parallelism: 3,
    aggregator_id: 'eve',
    timeout_ms: 600000,
  },
  members: [
    { member_id: 'alice', instance_alias: 'researcher-a' },
    { member_id: 'alice', instance_alias: 'researcher-b' },
    { member_id: 'alice', instance_alias: 'researcher-c' },
    { member_id: 'eve', instance_alias: 'aggregator' },
  ],
};

// ---------- Aggregated arrays (sorted by id, matches on-disk list() order) ----------

/** @type {import('./_react.js').any[]} */
export const SAMPLE_ROLES = [ROLE_RESEARCHER, ROLE_ENGINEER, ROLE_REVIEWER, ROLE_WRITER]
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id));

/** @type {import('./_react.js').any[]} */
export const SAMPLE_MEMBERS = [MEMBER_ALICE, MEMBER_BOB, MEMBER_CAROL, MEMBER_DAVE, MEMBER_EVE]
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id));

/** @type {import('./_react.js').any[]} */
export const SAMPLE_TEMPLATES = [TEMPLATE_DEEP_RESEARCH, TEMPLATE_SHIP_FEATURE, TEMPLATE_FAN_OUT_COLLECT]
  .slice()
  .sort((a, b) => a.id.localeCompare(b.id));
