import { z } from 'zod'
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import { clipToolText, type HomeChatToolResult } from '../../home-chat/tools/home-chat-tool-context'
import type { SealMcpToolRuntime } from './seal-mcp-scoped-runtime'
import type { SealMcpRpcToolName } from './seal-mcp-tool-catalog'

type Rec = Record<string, unknown>

const isRec = (value: unknown): value is Rec =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const records = (value: unknown): Rec[] => (Array.isArray(value) ? value.filter(isRec) : [])

const ok = (body: unknown): HomeChatToolResult => ({
  text: clipToolText(typeof body === 'string' ? body : JSON.stringify(body, null, 2)),
  isError: false
})

const RepoHostFields = z.object({
  connectionId: z.string().nullish().catch(null),
  executionHostId: z.string().nullish().catch(null)
})

function repoHost(repo: Rec): string {
  return getRepoExecutionHostId(RepoHostFields.parse(repo))
}

/**
 * Projects with the machine they live on. A project names its execution host (`local`,
 * `ssh:<id>` or `runtime:<id>`); the machine that uses that host is the id a client passes back.
 * `runtime` must already be narrowed to the client's allowlist, so with `restricted` a project
 * on any other machine is left out.
 */
export async function visibleRepos(
  runtime: SealMcpToolRuntime,
  restricted: boolean
): Promise<(Rec & { machine: string })[]> {
  const reply = await runtime.callRpc('repo.list', {})
  const machineByHost = new Map(
    (await runtime.machines.list()).map((machine) => [
      machine.executionHostId ?? machine.id,
      machine.id
    ])
  )
  return records(isRec(reply) ? reply.repos : null).flatMap((repo) => {
    const host = repoHost(repo)
    const machine = machineByHost.get(host)
    return machine || !restricted ? [{ ...repo, machine: machine ?? host }] : []
  })
}

async function listProjects(
  runtime: SealMcpToolRuntime,
  restricted: boolean
): Promise<HomeChatToolResult> {
  const repos = await visibleRepos(runtime, restricted)
  return ok(
    repos.map((repo) => ({
      id: repo.id,
      name: repo.displayName,
      path: repo.path,
      kind: repo.kind ?? 'git',
      machine: repo.machine
    }))
  )
}

/** Workspaces that belong to the given projects. */
export async function worktreesOf(
  runtime: SealMcpToolRuntime,
  repoIds: ReadonlySet<string | null>,
  query: Rec = {}
): Promise<Rec[]> {
  const reply = await runtime.callRpc('worktree.list', query)
  return records(isRec(reply) ? reply.worktrees : null).filter((worktree) =>
    repoIds.has(text(worktree.repoId))
  )
}

async function listWorkspaces(
  input: Rec,
  runtime: SealMcpToolRuntime,
  restricted: boolean
): Promise<HomeChatToolResult> {
  const repos = await visibleRepos(runtime, restricted)
  const repoIds = new Set(repos.map((repo) => text(repo.id)))
  const wanted = text(input.project)?.trim()
  const project = wanted
    ? repos.find((repo) => repo.id === wanted || repo.displayName === wanted)
    : undefined
  if (wanted && !project) {
    return { text: `No project "${wanted}". Use an id or name from list_projects.`, isError: true }
  }
  const worktrees = await worktreesOf(runtime, repoIds, {
    ...(project ? { repo: `id:${String(project.id)}` } : {}),
    ...(typeof input.limit === 'number' ? { limit: input.limit } : {})
  })
  return ok(
    worktrees.map((worktree) => ({
      id: worktree.id,
      name: worktree.displayName,
      path: worktree.path,
      branch: isRec(worktree.git) ? worktree.git.branch : undefined,
      project: worktree.repoId
    }))
  )
}

async function stopSession(input: Rec, runtime: SealMcpToolRuntime): Promise<HomeChatToolResult> {
  const sessionId = String(input.session_id ?? '').trim()
  // The session list is already narrowed to the client's machines.
  const { sessions } = await runtime.services.seal.sessions.list()
  const session = sessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    return {
      text: `No session ${sessionId}. Call list_sessions and use an id from it.`,
      isError: true
    }
  }
  const reply = await runtime.callRpc('liveSessions.remove', {
    sessionIds: [session.id],
    stop: true,
    deleteTranscripts: false,
    // Only stop: the session stays listed, ended, so its transcript can still be read.
    keep: true
  })
  const failed = records(isRec(reply) ? reply.failed : null)[0]
  if (failed) {
    return {
      text: `Seal could not stop ${session.id}: ${text(failed.error) ?? text(failed.reason) ?? 'unknown reason'}.`,
      isError: true,
      machine: session.machineLabel
    }
  }
  return {
    text: `Stopped ${session.id} on ${session.machineLabel}. It stays in Seal's session list, ended, with its transcript.`,
    isError: false,
    machine: session.machineLabel
  }
}

/** Tools answered by Seal's own RPC methods; `restricted` means the client has a machine allowlist. */
export function executeSealMcpRpcTool(
  tool: SealMcpRpcToolName,
  input: Rec,
  runtime: SealMcpToolRuntime,
  restricted: boolean
): Promise<HomeChatToolResult> {
  switch (tool) {
    case 'list_projects':
      return listProjects(runtime, restricted)
    case 'list_workspaces':
      return listWorkspaces(input, runtime, restricted)
    case 'stop_session':
      return stopSession(input, runtime)
  }
}
