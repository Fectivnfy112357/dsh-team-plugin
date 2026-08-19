/**
 * member-service.js — Member entity CRUD (全局素材库).
 *
 * Per architecture.md §4.2 / §5.2: Member = Role 实例化，全局持久化；删除前
 * 引用检查（被 team-templates / 在跑 run 引用 = 拒绝）。
 *
 * v1.0 scope: read + list. joinRun / sendMessage / dispatch are in P1+; the
 * shape of the joinRun seam is documented here so the team-panel UI can
 * subscribe to it later.
 *
 * @module dsh-team-plugin/member-service
 */
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getTeamPaths } from './paths.js';

/** @typedef {{
 *   id: string,
 *   role_id: string,
 *   display_name: string,
 *   persona: string,
 *   cli_options_override: Record<string, unknown>,
 *   metadata: Record<string, unknown>,
 * }} Member
 */

/**
 * List all members, sorted by id.
 * @returns {Promise<Member[]>}
 */
export async function list() {
  const dir = getTeamPaths().membersDir;
  if (!existsSync(dir)) return [];
  const entries = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of entries) {
    const m = await get(f.replace(/\.json$/, ''));
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** @param {string} id @returns {Promise<Member | undefined>} */
export async function get(id) {
  if (!id || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) return undefined;
  const path = join(getTeamPaths().membersDir, `${id}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return /** @type {Member} */ (JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return undefined;
  }
}

/**
 * joinRun seam (P1+; here we only document the shape and the active set of
 * responsibilities so a future implementation has a clear contract).
 *
 *   1. snapshot role + member metadata into meta.json.members[].snapshot
 *   2. ctx.subagents.startContinuable({ provider: 'acp-<adapter>', ... })
 *   3. write session-state.json with childId, current_session_id, etc.
 *   4. attach inbox listener (MessageService.send wakes via system-wake)
 *
 * Member service holds the SubagentHandle in v1.0; the run-service and
 * dispatch-service reach into member-service to keep the orchestration
 * surface small.
 */
