import { randomUUID } from 'node:crypto'
import { LOCAL_EXECUTION_HOST_ID, parseExecutionHostId } from '../../../shared/execution-host'
import { workspaceForSession } from '../../live-sessions/workspace-link/workspace-link-rules'
import {
  launchedChatSessionId,
  listedWorktrees,
  parseOrcaJson
} from '../delegation/home-chat-orca-json'
import {
  LOCAL_MACHINE_ID,
  type HomeChatExecResult,
  type HomeChatMachineInfo
} from '../machines/home-chat-machine-types'
import {
  optionalStr,
  str,
  type HomeChatToolContext,
  type HomeChatToolResult
} from './home-chat-tool-context'

/** How long start_session waits for its new chat to show in the session list. */
const NEW_CHAT_LISTED_MS = 15_000
const NEW_CHAT_POLL_MS = 500

const ok = (text: string, machine: string): HomeChatToolResult => ({
  text,
  isError: false,
  machine
})
const failed = (text: string): HomeChatToolResult => ({ text, isError: true })

/** `--environment` for a paired Seal server, which runs the command itself; nothing otherwise. */
function environmentArgs(info: HomeChatMachineInfo): string[] {
  const parsed = parseExecutionHostId(info.executionHostId ?? info.id)
  return parsed?.kind === 'runtime' ? ['--environment', parsed.environmentId] : []
}

/** Where `worktree create` makes the worktree: a paired server, an SSH host or this computer. */
function hostArgs(info: HomeChatMachineInfo): string[] {
  const host = info.executionHostId ?? info.id
  if (parseExecutionHostId(host)?.kind === 'runtime') {
    return environmentArgs(info)
  }
  return host === LOCAL_MACHINE_ID ? [] : ['--host', host]
}

function cliFailure(result: HomeChatExecResult): string {
  return (result.stderr || result.stdout).trim().slice(0, 2_000) || `exit code ${result.exitCode}`
}

/** The Seal workspace on a machine that holds a folder: the one at it, else its nearest ancestor. */
async function workspaceHolding(
  cwd: string,
  info: HomeChatMachineInfo,
  ctx: HomeChatToolContext
): Promise<{ selector: string; path: string } | string> {
  const result = await ctx.runOrcaCli(['worktree', 'list', '--json', ...environmentArgs(info)], {
    timeoutMs: 60_000,
    signal: ctx.signal
  })
  if (result.exitCode !== 0) {
    return `Seal could not list the workspaces on ${info.label}: ${cliFailure(result)}`
  }
  const host = info.executionHostId ?? info.id
  // A paired server lists its own workspaces as on this computer.
  const hostId = parseExecutionHostId(host)?.kind === 'ssh' ? host : LOCAL_EXECUTION_HOST_ID
  const found = workspaceForSession(
    { hostId, cwd, tabWorktreeId: null },
    listedWorktrees(parseOrcaJson(result.stdout)).map((row) => ({
      worktreeId: row.id,
      projectKey: row.repoId,
      hostId: row.hostId ?? LOCAL_EXECUTION_HOST_ID,
      path: row.path
    })),
    null
  )
  return found
    ? { selector: `id:${found.worktreeId}`, path: found.path }
    : `No Seal workspace on ${info.label} holds ${cwd}. Add that folder as a project in Seal, or pass project or worktree instead.`
}

/** The list_sessions id of a chat `agent launch` started, once the session list shows it. */
async function listedChatId(
  ctx: HomeChatToolContext,
  chatSessionId: string
): Promise<string | null> {
  const deadline = Date.now() + NEW_CHAT_LISTED_MS
  for (;;) {
    const { sessions } = await ctx.services.seal.sessions.list()
    const found = sessions.find((session) => session.chatSessionId === chatSessionId)
    if (found || Date.now() >= deadline || ctx.signal?.aborted) {
      return found?.id ?? null
    }
    await new Promise((resolve) => setTimeout(resolve, NEW_CHAT_POLL_MS))
  }
}

/** Starts a Seal chat the way the New chat button does: `agent launch --surface chat`. */
export async function startSession(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const project = optionalStr(input.project)
  const cwd = optionalStr(input.cwd)
  let worktree = optionalStr(input.worktree)
  if (!worktree && !project && !cwd) {
    return failed(
      'start_session needs worktree (an existing workspace), cwd (a folder in one) or project (to create a new worktree).'
    )
  }
  const machine = await ctx.machines.open(optionalStr(input.machine) ?? LOCAL_MACHINE_ID)
  if (machine.info.kind === 'hop') {
    return failed(
      `${machine.info.label} is reached through another machine, so Seal cannot host agent sessions on it. Use run_command there, or add it as an SSH host on the Machines page.`
    )
  }
  let workspacePath: string | null = null
  if (!worktree && !project && cwd) {
    const holding = await workspaceHolding(cwd, machine.info, ctx)
    if (typeof holding === 'string') {
      return failed(holding)
    }
    worktree = holding.selector
    workspacePath = holding.path
  }
  const agent = optionalStr(input.agent) ?? 'claude'
  const model = optionalStr(input.model)
  const effort = optionalStr(input.effort)
  const prompt = optionalStr(input.prompt)
  const launch = [
    '--agent',
    agent,
    '--surface',
    'chat',
    ...(model ? ['--model', model] : []),
    ...(effort ? ['--effort', effort] : []),
    ...(prompt ? ['--prompt', prompt] : [])
  ]
  const args = worktree
    ? ['agent', 'launch', '--worktree', worktree, ...launch, ...environmentArgs(machine.info)]
    : [
        'worktree',
        'create',
        '--project',
        str(project),
        '--name',
        optionalStr(input.name) ?? `assistant-${randomUUID().slice(0, 6)}`,
        ...launch,
        ...hostArgs(machine.info)
      ]
  const result = await ctx.runOrcaCli([...args, '--json'], {
    timeoutMs: 10 * 60_000,
    signal: ctx.signal
  })
  if (result.exitCode !== 0) {
    return failed(
      `Seal could not start the session on ${machine.info.label}: ${cliFailure(result)}`
    )
  }
  const chatId = launchedChatSessionId(parseOrcaJson(result.stdout))
  const sessionId = chatId ? await listedChatId(ctx, chatId) : null
  const where = workspacePath ? ` in the workspace at ${workspacePath}` : ''
  return ok(
    sessionId
      ? `Started a ${agent} chat on ${machine.info.label}${where}: session ${sessionId}. Follow it with read_session and steer it with message_session.`
      : `Started a ${agent} chat on ${machine.info.label}${where}${chatId ? ` (chat ${chatId})` : ''}. It appears in list_sessions once the agent is up; read it with read_session and steer it with message_session.`,
    machine.info.label
  )
}
