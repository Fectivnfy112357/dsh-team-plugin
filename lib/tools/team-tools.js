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
      // v2.0 #1 留口 flow engine rewiring wire-up: transition the freshly-
      // created run from `pending` to `assembling` so the flow engine's
      // state guard (`assembling | running | interrupted`) accepts it.
      // v1.0 left this transition to the host (DSH LLM or test); the
      // rewired team.start does it inline so the flow engine can drive
      // real subagents the moment team.start returns. This is the same
      // `pending → assembling` edge the smoke tests do explicitly via
      // `ts.transition(...)`.
      await teamService.transition(meta.id, 'pending', 'assembling', 'team-formed');
      // Kick off the flow engine in the background. v1.0 doesn't await it
      // here so team.start returns immediately to DSH; the DSH LLM
      // observes state via team.list and reacts to decision points via
      // team.respond_decision_point. The flow engine polls the DP registry
      // and the a2a-message-log to advance rounds.
      //
      // v2.0 #1 留口 flow engine rewiring: pass the DSH Cordis ctx (closed
      // over by `lib/index.js` at registration time, surfaced here as
      // `args.__dshCtx`) so the flow engine can drive real subagents via
      // `MemberService.dispatch`. When ctx is missing (smoke-test or any
      // host that doesn't close-over ctx), the engine falls back to the
      // v1.0 `dispatchLog`-only path inside the flow's `dispatchTask`
      // helper — fully backward compatible.
      const { run: runFlow } = await import('../../services/flow-engine.js');
      const flowCtx = args?.__dshCtx ?? null;
      runFlow(meta.id, flowCtx).catch(async (e) => {
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
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_a, v) => [{ type: 'text', text: Array.isArray(v) ? v.length + ' item(s)' : JSON.stringify(v) }] },
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
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
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
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_a, v) => [{ type: 'text', text: Array.isArray(v) ? v.length + ' item(s)' : JSON.stringify(v) }] },
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
  // ---- P2 抛光: cross-Run 引用硬删兜底 ----
  //
  // The artifact registry has no `delete` API. The "safe delete" path is
  // the only path: callers MUST go through `team.delete_artifact`, which
  // first checks `canDelete` (i.e. refCount === 0) and refuses otherwise.
  // The delete itself removes the manifest entry and unlinks the artifact
  // file from disk. There is no `force: true` override — the delete is a
  // hard, irreversible action, and the only way to bypass the ref guard
  // is to first remove the dependent artifacts (which themselves need to
  // be unreferenced, recursively). The single-writer principle for the
  // manifest holds: DSH is the only writer (writeJsonFile), and the
  // manifest is re-read on every register / refCount call (no in-process
  // cache beyond the 2.0 #2 index, which doesn't need to be invalidated
  // because the index is a reverse-direction lookup — removing a
  // consumer artifact naturally drops it from the index once the manifest
  // is re-read on next register).
  {
    name: 'team.delete_artifact',
    description:
      'Delete an artifact, but only if no other artifact references it (architecture §9.11.3). ' +
      'Removes the manifest entry and unlinks the artifact file. Throws on any cross-Run ref ' +
      'to force the caller to first clean up the dependent artifacts. Use `team.list_artifacts` ' +
      'to discover canDelete=true candidates.',
    parameters: {
      type: 'object',
      required: ['runId', 'artifactId'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string', description: 'Run that owns the artifact.' },
        artifactId: { type: 'string', description: 'The artifact id (without the run-id prefix).' },
        reason: { type: 'string', description: 'Why the artifact is being deleted (logged to state-history for audit).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['runId', 'artifactId', 'deleted'],
        properties: {
          runId: { type: 'string' },
          artifactId: { type: 'string' },
          deleted: { type: 'boolean' },
          refCountAtDelete: { type: 'number' },
        },
      },
      render: (args, value) => [
        { type: 'text', text: value.deleted ? `Deleted ${args.runId}/${args.artifactId}.` : `Refused to delete ${args.runId}/${args.artifactId}: ${value.refCountAtDelete} ref(s).` },
      ],
    },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.delete_artifact: runId is required');
      }
      if (typeof args.artifactId !== 'string' || args.artifactId.length === 0) {
        throw new Error('team.delete_artifact: artifactId is required');
      }
      const fullRef = `${args.runId}/${args.artifactId}`;
      // Always-log helper: append the audit row regardless of outcome
      // (refused or deleted). The audit trail covers both: a refused
      // delete tells the user "someone tried to delete but refs blocked
      // it"; a successful delete tells "this artifact is gone".
      const logAudit = async (outcome) => {
        try {
          const { appendLog } = await import('../../services/log-writer.js');
          await appendLog('state-history', args.runId, {
            kind: 'artifact-delete-attempt',
            from_state: 'running',
            to_state: 'running',
            reason: typeof args.reason === 'string' && args.reason.length > 0 ? args.reason : 'user-delete',
            outcome,
            artifact: fullRef,
            timestamp: new Date().toISOString(),
          });
        } catch { /* audit log is best-effort; never block the delete */ }
      };
      const canDel = await artifactRegistry.canDelete(fullRef);
      if (!canDel) {
        const refs = await artifactRegistry.refCount(fullRef);
        await logAudit('refused');
        return { runId: args.runId, artifactId: args.artifactId, deleted: false, refCountAtDelete: refs };
      }
      // Safe to delete. Resolve the entry to get the on-disk file path,
      // remove from manifest, then unlink. Order matters: manifest first
      // (so a crash between the two leaves a manifest without a file
      // rather than a file without a manifest — the latter would surface
      // as a "phantom" artifact to list_artifacts).
      const entry = await artifactRegistry.resolve(fullRef);
      if (!entry) {
        // canDelete returned true but the artifact is gone? Defensive
        // race; report as no-op.
        return { runId: args.runId, artifactId: args.artifactId, deleted: false, refCountAtDelete: 0 };
      }
      // Lazy-import the fs path utilities to keep the dependency surface
      // small and avoid loading unlink at module top.
      const { unlink } = await import('node:fs/promises');
      const { runDir } = await import('../../services/paths.js');
      // Mutate the manifest: rewrite without this artifact. We re-read
      // to avoid clobbering concurrent registers (single-writer, but
      // better to be defensive).
      const { readFile, writeFile } = await import('node:fs/promises');
      const manifestPath = `${runDir(args.runId)}/artifacts-manifest.json`;
      let manifest = { artifacts: [] };
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
      } catch { /* missing manifest = nothing to remove */ }
      const before = Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0;
      manifest.artifacts = (manifest.artifacts ?? []).filter((a) => a.id !== args.artifactId);
      const after = manifest.artifacts.length;
      if (after < before) {
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
      }
      // Unlink the artifact file. The path is relative to <team-runs>/<run-id>/.
      const filePath = `${runDir(args.runId)}/${entry.file}`;
      try {
        await unlink(filePath);
      } catch (e) {
        // The manifest has been updated but the file is gone or
        // un-unlinkable. The delete is still considered successful
        // (the manifest is the source of truth). ENOENT is benign.
        if (e?.code !== 'ENOENT') {
          // No `ctx` here (we don't have it in `execute(args)`); the
          // outer tool registration does NOT close over ctx for this
          // tool because it doesn't need it. Surface a console.warn
          // so a host watching the process stderr sees the warning.
          console.warn(`team.delete_artifact: unlink ${filePath} failed: ${e.message}`);
        }
      }
      // Audit trail: append a state-history row marking the deletion.
      // Always logged (via the closure above) for both refusal and success
      // — the audit surface is a single line per attempt.
      await logAudit('deleted');
      // Invalidate the in-memory cross-Run index so the next refCount
      // call rebuilds from disk. The reverse-direction index has stale
      // entries for the deleted consumer (this run's manifest no longer
      // contains the entry, but the index still has it as a consumer
      // of older refs). A rebuild picks up the new disk state.
      try { artifactRegistry._resetIndexForTests(); } catch { /* private API; best-effort */ }
      return { runId: args.runId, artifactId: args.artifactId, deleted: true, refCountAtDelete: 0 };
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
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
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
  // ---- P1 #6: resume an interrupted Team Run (同 run 状态回滚) ----
  //
  // Per architecture.md §6.3 + requirements.md §9.7:
  //   - team.resume 恢复"同 run 状态回滚"语义:仅对 state=interrupted 的
  //     run 有效;ALLOWED 转换 `interrupted → assembling`;重 join 成员;
  //     重启 flow engine。**与 team.rerun 不同**:team.rerun 是"配置克隆"
  //     (新 run-id),team.resume 是"同 run 状态回滚"(原 run-id 保留历史)
  //   - 单写入者承诺不变:dispatch-log / state-history 由 DSH 写
  //   - context_refs 沿用原 flow_config,跨步产物自动从 stepOutputs 派生
  //   - 同 run 走 `interrupted → assembling` 边(ALLOWED),失败重抛
  //   - 进程级 DSH 重启后的 reconcileOnBoot 标记的 run 也能直接走 resume
  {
    name: 'team.resume',
    description:
      'Resume an interrupted Team Run. Reads the run\'s current state, validates the ' +
      '`interrupted → assembling` transition (architecture §6.3), re-joins all members ' +
      'via `MemberService.joinRun` (idempotent), then re-launches the flow engine. ' +
      'Distinct from `team.rerun` (which clones the run with a new runId); `team.resume` ' +
      'preserves the original runId and history. Throws if the run is not in state=interrupted.',
    parameters: {
      type: 'object',
      required: ['runId'],
      additionalProperties: false,
      properties: {
        runId: { type: 'string', description: 'The interrupted run to resume.' },
        reason: { type: 'string', description: 'Why the resume is happening (recorded in state-history).' },
      },
    },
    output: {
      schema: {
        type: 'object',
        required: ['runId', 'state'],
        properties: {
          runId: { type: 'string' },
          state: { type: 'string' },
          reJoined: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (args, value) => [
        { type: 'text', text: `Run ${value.runId} resumed (state=${value.state}, re-joined ${value.reJoined.length} member(s)).` },
      ],
    },
    async execute(args) {
      if (typeof args.runId !== 'string' || args.runId.length === 0) {
        throw new Error('team.resume: runId is required');
      }
      // 1. Read meta + validate state. ALLOWED transitions for `interrupted`:
      //    { assembling, aborted, archived } — only assembling kicks the run
      //    back into active life.
      const meta = await teamService.readMeta(args.runId);
      if (!meta) throw new Error(`team.resume: run ${args.runId} not found`);
      if (meta.state !== 'interrupted') {
        throw new Error(
          `team.resume: run ${args.runId} is in state=${meta.state}; only state=interrupted can be resumed ` +
          `(use team.abort to terminate, or team.rerun to clone a completed run)`,
        );
      }
      // 2. Re-mark the holder. The DSH process may have changed since the
      //    reconcileOnBoot interrupt; markHolder is the v1.0 mechanism that
      //    tags the run as held by this process (so a future reconcile doesn't
      //    re-mark it as interrupted on next boot).
      await teamService.markHolder(args.runId);
      // 3. Transition interrupted -> assembling. The transition function
      //    validates the edge against ALLOWED and appends a state-history
      //    row with `reason: 'user-resume'` (or the caller-supplied reason).
      const reason = typeof args.reason === 'string' && args.reason.length > 0
        ? args.reason
        : 'user-resume';
      await teamService.transition(args.runId, 'interrupted', 'assembling', reason);
      // 4. Re-join every member. MemberService.joinRun is idempotent:
      //    a member that still has a live child (state=running) returns
      //    the existing record without spawning; a member that was
      //    terminated in the previous run is rejected (re-join is not
      //    supported). This is the contract — a terminated member means
      //    the run's invariant is broken; the user should clone (rerun)
      //    instead of resuming.
      //
      //    When `__dshCtx` is missing (smoke-test / no-DSH-runtime), we
      //    skip the re-join and let the flow engine fall back to its
      //    v1.0 `dispatchLog`-only path. The state transition still
      //    happens; the resume is "best-effort" in the no-runtime case.
      const reJoined = [];
      const flowCtx = args?.__dshCtx ?? null;
      // Lazy-load to avoid a circular import at module top.
      const { joinRun } = await import('../../services/member-service.js');
      if (flowCtx?.subagents?.startContinuable) {
        for (const m of meta.members) {
          try {
            const r = await joinRun(flowCtx, args.runId, m.member_id, {
              ...(flowCtx?.parent ? { parent: flowCtx.parent } : {}),
            });
            if (r?.childId) reJoined.push(m.member_id);
          } catch (e) {
            // A terminated member is the most likely failure. Surface it
            // and abort the resume — partial rejoin is worse than no resume.
            if (/already terminated/.test(String(e?.message ?? e))) {
              // Roll back the assembling transition so the run stays in a
              // recoverable state (interrupted). Transition interrupted ->
              // assembling is a one-way edge in the state machine; the ALLOWED
              // table does not list `assembling -> interrupted`, so the rollback
              // is via direct state-history + meta write (best-effort).
              try {
                const { appendLog, writeJsonFile } = await import('../../services/log-writer.js');
                const { runDir } = await import('../../services/paths.js');
                await appendLog('state-history', args.runId, {
                  from_state: 'assembling',
                  to_state: 'interrupted',
                  reason: 'resume-rollback: terminated-member',
                  timestamp: new Date().toISOString(),
                });
                const current = await teamService.readMeta(args.runId);
                if (current) {
                  await writeJsonFile(`${runDir(args.runId)}/meta.json`, { ...current, state: 'interrupted' });
                }
              } catch { /* best-effort rollback; surface the original error */ }
            }
            throw e;
          }
        }
      }
      // 5. Re-launch the flow engine. The same flow used at start() will
      //    pick up from the current state — round-table polls convergence
      //    + max_rounds; pipeline waits for the next signalStepTerminal;
      //    fan-out re-fans. v2.0 #1 rewiring passes __dshCtx through so
      //    the flow can drive real subagents via MemberService.dispatch.
      const { run: runFlow } = await import('../../services/flow-engine.js');
      runFlow(args.runId, flowCtx).catch(async (e) => {
        const { appendLog } = await import('../../services/log-writer.js');
        await appendLog('user-intervention-log', args.runId, {
          kind: 'flow-engine-failure',
          message: String(e?.message ?? e),
          timestamp: new Date().toISOString(),
        }).catch(() => undefined);
      });
      return { runId: args.runId, state: 'assembling', reJoined };
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
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_a, v) => [{ type: 'text', text: Array.isArray(v) ? v.length + ' item(s)' : JSON.stringify(v) }] },
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
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
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
    output: { schema: { type: 'array', items: { type: 'object' } }, render: (_a, v) => [{ type: 'text', text: Array.isArray(v) ? v.length + ' item(s)' : JSON.stringify(v) }] },
    async execute() {
      return listAdapterIds().map((id) => ({ id, ...getAdapter(id) }));
    },
  },
];
