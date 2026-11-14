import { LOCAL_MACHINE_ID } from '../../home-chat/machines/home-chat-machine-types'
import { optionalStr } from '../../home-chat/tools/home-chat-tool-context'
import { visibleRepos, worktreesOf } from './seal-mcp-rpc-tools'
import type { SealMcpToolRuntime } from './seal-mcp-scoped-runtime'

type Input = Record<string, unknown>

/**
 * `start_session` names a project or workspace, and that decides the machine the agent runs on,
 * whatever `machine` says. For a client with a machine allowlist, this pins the call to a project
 * or workspace on its machines, by id, or refuses it. `scoped` is the runtime narrowed to them.
 */
export async function pinSessionTargetToAllowedMachines(
  input: Input,
  scoped: SealMcpToolRuntime
): Promise<{ input: Input } | { refusal: string }> {
  const machine = await scoped.machines.open(optionalStr(input.machine) ?? LOCAL_MACHINE_ID)
  // A paired Seal server resolves the names itself, and all of it is the one allowed machine.
  if (machine.info.executionHostId?.startsWith('runtime:')) {
    return { input }
  }
  const repos = await visibleRepos(scoped, true)
  const worktree = optionalStr(input.worktree)
  if (worktree) {
    const wanted = worktree.replace(/^(id|worktree):/, '')
    const found = (await worktreesOf(scoped, new Set(repos.map((repo) => String(repo.id))))).find(
      (candidate) => candidate.id === wanted || `path:${String(candidate.path)}` === worktree
    )
    return found
      ? { input: { ...input, worktree: `id:${String(found.id)}` } }
      : {
          refusal: `No workspace "${worktree}" on a machine this MCP client may use. Use an id from list_workspaces.`
        }
  }
  const project = optionalStr(input.project)
  if (project) {
    const found = repos.find((repo) => repo.id === project || repo.displayName === project)
    return found
      ? { input: { ...input, project: String(found.id) } }
      : {
          refusal: `No project "${project}" on a machine this MCP client may use. Use an id or name from list_projects.`
        }
  }
  return { input }
}
