/**
 * team-tools.js — DSH plugin tools for the Team Run lifecycle.
 *
 * Per dsh-dual-plugin-guide: static plugins register via
 * `ctx.tools.register(defineTool({...}))`. The dynamic-plugin
 * `harness.defineTool` is **not** available in this code path.
 *
 * Tools registered:
 *   - team.start  — create a Team Run from taskDescription + flow + members
 *   - team.list   — list runs (optionally filtered by state)
 *   - team.abort  — abort a non-terminal run
 *
 * v1.0 scope: only the envelope (meta.json + state-history + holder.pid +
 * per-member session-state skeleton). The flow engine (round-table /
 * pipeline / fan-out) is a P1+ concern; for now `team.start` returns
 * state=pending and the caller is expected to either call `team.abort` or
 * leave the run for P1 to drive.
 *
 * @module dsh-team-plugin/team-tools
 */
import * as teamService from '../../services/team-service.js';
import * as dpService from '../../services/decision-point-service.js';
import * as pipelineFlow from '../../services/pipeline-flow.js';
import * as fanOutFlow from '../../services/fan-out-flow.js';
import * as planService from '../../services/plan-service.js';
import * as artifactRegistry from '../../services/artifact-registry.js';
import { ADAPTERS, getAdapter, listAdapterIds } from '../../services/adapters.js';
import { resolveTeamPaths } from '../../services/paths.js';

/**
 * Validate the StartTeamRunRequest shape. Shared by the tool and by any
 * non-Skill entry point (e.g. UI buttons).
 * @param {unknown} req
 */
function validateStartRequest(req) {
  if (!req || typeof req !== 'object') {
    throw new Error('team.start: request body must be an object');
  }
  const r = /** @type {Record<string, unknown>} */ (req);
  if (typeof r.taskDescription !== 'string' || r.taskDescription.length === 0) {
    throw new Error('team.start: taskDescription is required');
  }
  if (
    r.flow !== 'handoff-round-table' &&
    r.flow !== 'pipeline-with-feedback' &&
    r.flow !== 'fan-out-collect'
  ) {
    throw new Error(`team.start: invalid flow "${r.flow}"`);
  }
  if (!Array.isArray(r.members) || r.members.length === 0) {
    throw new Error('team.start: members must be a non-empty array');
  }
  for (const m of r.members) {
    if (!m || typeof m !== 'object') {
      throw new Error('team.start: each member must be an object');
    }
    if (typeof m.member_id !== 'string' || m.member_id.length === 0) {
      throw new Error('team.start: each member must have member_id');
    }
    if (typeof m.instance_alias !== 'string' || m.instance_alias.length === 0) {
      throw new Error('team.start: each member must have instance_alias');
    }
  }
  if (r.flowConfig !== undefined && (typeof r.flowConfig !== 'object' || r.flowConfig === null)) {
    throw new Error('team.start: flowConfig must be an object when provided');
  }
}

/**
 * Tool definitions in a shape compatible with the DSH static plugin
 * convention. We export the objects instead of registering them here so
 * `lib/index.js` can hand them to `ctx.tools.register` inside an effect
 * (effect-wrapped registration is the dsh-dual-plugin-guide recommended
 * pattern; per the tools.md reference, "不要两者都包一遍" — we let the
 * caller decide).
 */
export const teamTools = [
  {
    name: 'team.start',
    description:
      'Create a new Team Run from a task description, a flow type, and a list of members. ' +
      'Returns the initial run metadata (runId, state=pending). ' +
      'The flow engine + member joining are not driven by v1.0; this tool only ' +
      'creates the run envelope. Use team.abort to cancel.',
    parameters: {
      type: 'object',
      required: ['taskDescription', 'flow', 'members'],
      additionalProperties: false,
      properties: {
        taskDescription: { type: 'string', description: 'What the team should do.' },
        flow: {
          type: 'string',
          description: 'Collaboration flow.',
          enum: ['handoff-round-table', 'pipeline-with-feedback', 'fan-out-collect'],
        },
        flowConfig: {
          type: 'object',
          description: 'Flow-specific options (max_rounds, ad_hoc_decision_points, cost_cap...).',
          additionalProperties: true,
        },
        members: {
          type: 'array',
          description: 'Member refs (member_id + instance_alias).',
          minItems: 1,
          items: {
            type: 'object',
            required: ['member_id', 'instance_alias'],
            additionalProperties: false,
            properties: {
              member_id: { type: 'string' },
              instance_alias: { type: 'string' },
            },
          },
        },
        templateId: { type: 'string', description: 'Optional team-template id (members come from the template).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['runId', 'state'],
        properties: {
          runId: { type: 'string' },
          state: { type: 'string' },
          meta: { type: 'object' },
        },
      },
      render: (args, value) => [
        { type: 'text', text: `Team Run ${value.runId} created (state=${value.state}).` },
      ],
    },
    async execute(args) {
      validateStartRequest(args);
      const meta = await teamService.start({
        taskDescription: args.taskDescription,
        flow: args.flow,
        flowConfig: args.flowConfig ?? {},
        members: args.members,
        templateId: args.templateId,
      });
      await teamService.markHolder(meta.id);
      // Kick off the flow engine in the background. v1.0 doesn't await it
      // here so team.start returns immediately to DSH; the DSH LLM
      // observes state via team.list and reacts to decision points via
      // team.respond_decision_point. The flow engine polls the DP registry
      // and the a2a-message-log to advance rounds.
      const { run: runFlow } = await import('../../services/flow-engine.js');
      runFlow(meta.id, null).catch(async (e) => {
        // Surface flow engine failures in the user-intervention log so
        // the run can be inspected post-mortem.
        const { appendLog } = await import('../../services/log-writer.js');
        await appendLog('user-intervention-log', meta.id, {
          kind: 'flow-engine-failure',
          message: String(e?.message ?? e),
          timestamp: new Date().toISOString(),
        }).catch(() => undefined);
      });
      return { runId: meta.id, state: meta.state, meta };
    },
  },
  {
    name: 'team.list',
    description: 'List Team Runs, newest first. Optionally filter by state.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: {
          type: 'string',
          description: 'Filter by state.',
          enum: [
            'pending',
            'assembling',
            'running',
            'succeeded',
            'failed',
            'interrupted',
            'aborted',
            'archived',
          ],
        },
        includeArchived: { type: 'boolean', description: 'Include archived runs (default false).' },
      },
    },
    output: {
      schema: {
        type: 'array',
        items: { type: 'object' },
      },
      render: (args, value) => [
        { type: 'text', text: `${value.length} run(s) at ${resolveTeamPaths().teamRunsDir}` },
      ],
    },
    async execute(args) {
      return teamService.list({
        ...(args.state ? { state: args.state } : {}),
        includeArchived: args.includeArchived === true,
      });
    },
  },
  {
    name: 'team.abort',
    description: 'Abort a non-terminal Team Run. Independent terminal state (D1-1).',
    parameters: {
      type: 'object',
      required: ['runId', 'reason'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        reason: { type: 'string', description: 'Why the user is aborting (recorded in state-history).' },
      },
    },
    output: {
      schema: { type: 'object' },
      render: (args, value) => [
        { type: 'text', text: `Run ${args.runId} aborted (state=aborted).` },
      ],
    },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.abort: runId is required');
      }
      if (typeof args.reason !== 'string' || args.reason.length === 0) {
        throw new Error('team.abort: reason is required');
      }
      const meta = await teamService.abort(args.runId, args.reason);
      return { runId: args.runId, state: meta.state, meta };
    },
  },
  {
    name: 'team.open_decision_point',
    description:
      'Open an ad-hoc decision point (user-pull gate). The DP is independent of the ' +
      'flow engine and is consumed via team.respond_decision_point. Per requirements.md ' +
      '§9.10.1 this is the "用户主动拉的 ad-hoc 门" (only available when ' +
      'flow_config.ad_hoc_decision_points=true).',
    parameters: {
      type: 'object',
      required: ['runId', 'prompt'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        prompt: { type: 'string', description: 'What to ask the user (shown in the panel).' },
        contextRefs: { type: 'array', items: { type: 'string' }, description: 'Optional artifact ids to attach.' },
        waitMinutes: { type: 'number', description: 'Override global default (10 min).' },
      },
    },
    output: { schema: { type: 'object' }, render: () => [{ type: 'text', text: 'decision point opened' }] },
    async execute(args) {
      const dp = await dpService.open({
        runId: args.runId,
        kind: 'ad-hoc',
        prompt: args.prompt,
        contextRefs: args.contextRefs,
        waitMinutes: args.waitMinutes,
      });
      return { dpId: dp.id, runId: dp.runId, kind: dp.kind, openedAt: dp.openedAt };
    },
  },
  {
    name: 'team.respond_decision_point',
    description:
      'Record a user response to a decision point. action ∈ {continue, complete, abort}; ' +
      'optional feedback is injected into the next round\'s dispatch.task (requirements §9.10.3).',
    parameters: {
      type: 'object',
      required: ['dpId', 'action'],
      additionalProperties: false,
      properties: {
        dpId: { type: 'string' },
        action: { type: 'string', enum: ['continue', 'complete', 'abort'] },
        feedback: { type: 'string', description: 'Optional free-text (constraints / corrections / extra info).' },
        isAdHoc: { type: 'boolean', description: 'True if responding to an ad-hoc DP (cosmetic; default false).' },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `dp responded: action=${v.action}` }] },
    async execute(args) {
      const dp = await dpService.respond(args.dpId, {
        action: args.action,
        ...(args.feedback ? { feedback: args.feedback } : {}),
        isAdHoc: args.isAdHoc === true,
      });
      return { dpId: dp.id, status: dp.status, response: dp.response };
    },
  },
  {
    name: 'team.list_decision_points',
    description: 'List open decision points (optionally filtered by runId).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { runId: { type: 'string' } },
    },
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_a, v) => [{ type: 'text', text: `${v.length} open dp(s)` }] },
    async execute(args) {
      return dpService.waitingDecisions(args.runId);
    },
  },
  {
    name: 'team.complete_step',
    description:
      'Mark the current pipeline step as complete. Resolves the flow engine ' +
      'waiter with the produced artifact ids. Per architecture §4.7.2, this is ' +
      'the "DSH -> member dispatch has terminated successfully" signal.',
    parameters: {
      type: 'object',
      required: ['runId', 'stepIndex'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        stepIndex: { type: 'number', minimum: 0, description: '0-based step index.' },
        producedArtifactIds: { type: 'array', items: { type: 'string' } },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `step ${v.stepIndex} marked complete` }] },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.complete_step: runId is required');
      }
      if (typeof args.stepIndex !== 'number' || args.stepIndex < 0) {
        throw new Error('team.complete_step: stepIndex must be a non-negative number');
      }
      pipelineFlow.signalStepTerminal(args.runId, args.stepIndex, 'complete', {
        produced_artifact_ids: args.producedArtifactIds ?? [],
      });
      return { runId: args.runId, stepIndex: args.stepIndex, terminal: 'complete' };
    },
  },
  {
    name: 'team.fail_step',
    description:
      'Mark the current pipeline step as failed with feedback. Triggers the ' +
      'feedback loop: if retry < step.max_retries the engine re-dispatches ' +
      'with feedback appended; otherwise the run transitions to failed.',
    parameters: {
      type: 'object',
      required: ['runId', 'stepIndex', 'feedback'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        stepIndex: { type: 'number', minimum: 0 },
        feedback: { type: 'string', description: 'What needs to change ("需修改清单").' },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `step ${v.stepIndex} marked failed` }] },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.fail_step: runId is required');
      }
      if (typeof args.stepIndex !== 'number' || args.stepIndex < 0) {
        throw new Error('team.fail_step: stepIndex must be a non-negative number');
      }
      if (typeof args.feedback !== 'string' || args.feedback.length === 0) {
        throw new Error('team.fail_step: feedback is required');
      }
      pipelineFlow.signalStepTerminal(args.runId, args.stepIndex, 'fail', {
        feedback: args.feedback,
      });
      return { runId: args.runId, stepIndex: args.stepIndex, terminal: 'fail' };
    },
  },
  {
    name: 'team.complete_branch',
    description:
      'Mark a fan-out branch as complete (Story 3 fan-out-collect). ' +
      'Resolves the branch waiter for memberId. The flow engine aggregates ' +
      'all completed branches and dispatches the aggregator (if configured).',
    parameters: {
      type: 'object',
      required: ['runId', 'memberId'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        memberId: { type: 'string' },
        producedArtifactIds: { type: 'array', items: { type: 'string' } },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `branch ${v.memberId} complete` }] },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.complete_branch: runId is required');
      }
      if (typeof args.memberId !== 'string' || args.memberId.length === 0) {
        throw new Error('team.complete_branch: memberId is required');
      }
      fanOutFlow.signalBranchTerminal(args.runId, args.memberId, 'complete', {
        produced_artifact_ids: args.producedArtifactIds ?? [],
      });
      return { runId: args.runId, memberId: args.memberId, terminal: 'complete' };
    },
  },
  {
    name: 'team.fail_branch',
    description:
      'Mark a fan-out branch as failed. The flow engine sets the degraded ' +
      'flag if at least one other branch completes; if all branches fail the ' +
      'run transitions to failed.',
    parameters: {
      type: 'object',
      required: ['runId', 'memberId', 'feedback'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        memberId: { type: 'string' },
        feedback: { type: 'string' },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `branch ${v.memberId} failed` }] },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.fail_branch: runId is required');
      }
      if (typeof args.memberId !== 'string' || args.memberId.length === 0) {
        throw new Error('team.fail_branch: memberId is required');
      }
      if (typeof args.feedback !== 'string' || args.feedback.length === 0) {
        throw new Error('team.fail_branch: feedback is required');
      }
      fanOutFlow.signalBranchTerminal(args.runId, args.memberId, 'fail', {
        feedback: args.feedback,
      });
      return { runId: args.runId, memberId: args.memberId, terminal: 'fail' };
    },
  },
  // ---- P4: Plan + Artifact ----
  {
    name: 'team.add_plan',
    description:
      'DSH writes a plan to a Team Run. produced_by is always "scheduler"; ' +
      'derived_from is required (selectable from decision / conclusion msg / ' +
      'user-intervention-log action=complete). per architecture §4.6.',
    parameters: {
      type: 'object',
      required: ['runId', 'derivedFrom', 'body', 'steps'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        derivedFrom: { type: 'array', items: { type: 'string' }, minItems: 1 },
        body: { type: 'string' },
        steps: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['role', 'intent', 'expected_artifact'],
            additionalProperties: false,
            properties: {
              role: { type: 'string' },
              intent: { type: 'string', enum: ['produce', 'review', 'collect', 'synthesize', 'decide'] },
              expected_artifact: {
                type: 'object',
                required: ['type', 'desc'],
                additionalProperties: false,
                properties: { type: { type: 'string' }, desc: { type: 'string' } },
              },
            },
          },
        },
      },
    },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: `plan ${v.id} created` }] },
    async execute(args) {
      const plan = await planService.generate({
        runId: args.runId,
        derivedFrom: args.derivedFrom,
        body: args.body,
        steps: args.steps,
      });
      return { id: plan.id, runId: plan.run_id, createdAt: plan.created_at };
    },
  },
  {
    name: 'team.list_plans',
    description: 'List all plans for a run.',
    parameters: {
      type: 'object',
      required: ['runId'],
      additionalProperties: false,
      properties: { runId: { type: 'string' } },
    },
    output: { schema: { type: 'array', items: { type: 'object' } } },
    async execute(args) {
      return planService.list(args.runId);
    },
  },
  {
    name: 'team.register_artifact',
    description:
      'Register a member-produced artifact. Idempotent: re-registering the same ' +
      'id is a no-op (immutable snapshot contract). derived_from references can ' +
      'use the cross-Run form "<run-id>/<artifact-id>" (OQ-3 default).',
    parameters: {
      type: 'object',
      required: ['runId', 'id', 'type', 'file', 'producedBy'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        id: { type: 'string' },
        type: { type: 'string' },
        file: { type: 'string', description: 'Relative to <team-runs>/<run-id>/' },
        producedBy: { type: 'string' },
        memberId: { type: 'string' },
        producedInDispatch: { type: 'string' },
        producedInSession: { type: 'string' },
        derivedFrom: { type: 'array', items: { type: 'string' } },
      },
    },
    output: { schema: { type: 'object' } },
    async execute(args) {
      const meta = await artifactRegistry.register({
        runId: args.runId,
        id: args.id,
        type: args.type,
        file: args.file,
        produced_by: args.producedBy,
        ...(args.memberId ? { member_id: args.memberId } : {}),
        ...(args.producedInDispatch ? { produced_in_dispatch: args.producedInDispatch } : {}),
        ...(args.producedInSession ? { produced_in_session: args.producedInSession } : {}),
        derived_from: args.derivedFrom ?? [],
      });
      return meta;
    },
  },
  {
    name: 'team.list_artifacts',
    description: 'List artifacts for a run, plus per-artifact refCount.',
    parameters: {
      type: 'object',
      required: ['runId'],
      additionalProperties: false,
      properties: { runId: { type: 'string' } },
    },
    output: { schema: { type: 'array', items: { type: 'object' } } },
    async execute(args) {
      const list = await artifactRegistry.list(args.runId);
      const out = [];
      for (const a of list) {
        const fullRef = `${a.run_id}/${a.id}`;
        const refs = await artifactRegistry.refCount(fullRef);
        out.push({ ...a, refCount: refs, canDelete: refs === 0 });
      }
      return out;
    },
  },
  // ---- P5: 多 Team + 历史 ----
  {
    name: 'team.rerun',
    description:
      'Create a new Team Run cloning an existing one. Same flow + members; ' +
      'optional modifiedTask overrides taskDescription; injectArtifacts seeds ' +
      'the first dispatch.context_refs (per architecture §4.1 / §12.5 A4).',
    parameters: {
      type: 'object',
      required: ['sourceRunId'],
      additionalProperties: false,
      properties: {
        sourceRunId: { type: 'string' },
        modifiedTask: { type: 'string', description: 'Override the original task description (optional).' },
        injectArtifacts: { type: 'array', items: { type: 'string' }, description: 'Cross-Run artifact refs to inject.' },
      },
    },
    output: { schema: { type: 'object' } },
    async execute(args) {
      const source = await teamService.readMeta(args.sourceRunId);
      if (!source) throw new Error(`team.rerun: source run ${args.sourceRunId} not found`);
      // Resolve inject artifacts up-front (fail loudly if any are missing)
      const resolved = [];
      for (const ref of args.injectArtifacts ?? []) {
        const meta = await artifactRegistry.resolve(ref);
        if (!meta) throw new Error(`team.rerun: injected artifact not found: ${ref}`);
        resolved.push({ ref, type: meta.type });
      }
      const newMeta = await teamService.start({
        taskDescription: args.modifiedTask ?? source.task_description,
        flow: source.flow,
        flowConfig: {
          ...source.flow_config,
          // Carry the injected artifacts into the first dispatch via context_refs
          ...(resolved.length > 0 ? { injected_context_refs: resolved } : {}),
        },
        members: source.members.map((m) => ({ member_id: m.member_id, instance_alias: m.instance_alias })),
        ...(source.template_id ? { templateId: source.template_id } : {}),
      });
      await teamService.markHolder(newMeta.id);
      // Kick off the flow with the same logic as team.start
      const { run: runFlow } = await import('../../services/flow-engine.js');
      runFlow(newMeta.id, null).catch(async (e) => {
        const { appendLog } = await import('../../services/log-writer.js');
        await appendLog('user-intervention-log', newMeta.id, {
          kind: 'flow-engine-failure',
          message: String(e?.message ?? e),
          timestamp: new Date().toISOString(),
        }).catch(() => undefined);
      });
      return { runId: newMeta.id, state: newMeta.state, sourceRunId: args.sourceRunId, injectedArtifacts: resolved };
    },
  },
  {
    name: 'team.list_runs',
    description:
      'List Team Runs with optional filters. Powers the side bar active + ' +
      'historical views (P5).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string' },
        includeArchived: { type: 'boolean' },
        flow: { type: 'string' },
        limit: { type: 'number', description: 'Cap the number of returned runs (default 50).' },
      },
    },
    output: { schema: { type: 'array', items: { type: 'object' } } },
    async execute(args) {
      let list = await teamService.list({
        ...(args.state ? { state: args.state } : {}),
        includeArchived: args.includeArchived === true,
      });
      if (args.flow) list = list.filter((r) => r.flow === args.flow);
      if (typeof args.limit === 'number' && args.limit > 0) list = list.slice(0, args.limit);
      return list;
    },
  },
  // ---- P6: 成本纪律 ----
  {
    name: 'team.check_cost_cap',
    description:
      'Open a decision point when cost cap is hit. Caller (flow engine) ' +
      'computes the cost; this tool only opens the DP. action ∈ ' +
      '{continue(续 N 轮), complete, abort}; user timeout -> abort (cost ' +
      'cap = 预算 != 失败, §9.13 ③).',
    parameters: {
      type: 'object',
      required: ['runId', 'costSoFar', 'costCap'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string' },
        costSoFar: { type: 'number' },
        costCap: { type: 'number' },
        extraRounds: { type: 'number', description: 'If user picks "continue", how many more rounds to allow.' },
      },
    },
    output: { schema: { type: 'object' } },
    async execute(args) {
      const dp = await dpService.open({
        runId: args.runId,
        kind: 'ad-hoc',
        prompt: `成本上限触顶: 已用 ${args.costSoFar} / 上限 ${args.costCap}. 是否续 ${args.extraRounds ?? 1} 轮?`,
        waitMinutes: 5,
      });
      return { dpId: dp.id, runId: dp.runId };
    },
  },
  // ---- P8: Adapter registry ----
  {
    name: 'team.list_adapters',
    description:
      'List the closed Adapter set (hermes / mcode / claude-code). ' +
      'Per architecture §6 + §10.1, the set is closed — users cannot add ' +
      'new adapters without rebuilding the plugin (J decision).',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    output: { schema: { type: 'array', items: { type: 'object' } } },
    async execute() {
      return listAdapterIds().map((id) => ({ id, ...getAdapter(id) }));
    },
  },
];
