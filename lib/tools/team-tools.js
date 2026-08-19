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
];
