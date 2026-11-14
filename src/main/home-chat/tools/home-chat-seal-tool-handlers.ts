import { randomUUID } from 'node:crypto'
import { parseExecutionHostId } from '../../../shared/execution-host'
import type { HomeChatOpenView } from '../../../shared/home-chat/home-chat-types'
import { agentTerminalHandle, parseOrcaJson } from '../delegation/home-chat-orca-json'
import { LOCAL_MACHINE_ID, type HomeChatMachineInfo } from '../machines/home-chat-machine-types'
import type { HomeChatSessionSummary } from '../seal/home-chat-session-access'
import type { HomeChatCatalogEntry } from '../skills/home-chat-machine-catalog'
import type { HomeChatSealToolName } from './home-chat-tool-definitions'
import {
  clipToolText,
  optionalStr,
  str,
  type HomeChatToolContext,
  type HomeChatToolResult
} from './home-chat-tool-context'

const ok = (text: string, machine?: string): HomeChatToolResult => ({
  text,
  isError: false,
  ...(machine ? { machine } : {})
})
const failed = (text: string): HomeChatToolResult => ({ text, isError: true })

const OPEN_VIEWS: ReadonlySet<string> = new Set<HomeChatOpenView>([
  'home',
  'machines',
  'sessions',
  'tasks',
  'activity',
  'automations',
  'skills',
  'settings'
])

function ago(at: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60_000))
  if (minutes < 1) {
    return 'just now'
  }
  return minutes < 90 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

function sessionLine(session: HomeChatSessionSummary): string {
  const where = session.cwd ?? session.project ?? 'unknown folder'
  const flags = [
    session.origin === 'seal' ? 'in a Seal pane' : 'outside Seal',
    session.alive ? null : 'process not running',
    session.canTakeOver ? 'can be taken over' : null
  ].filter(Boolean)
  return `- ${session.id}\n  ${session.agent} on ${session.machineLabel} (${session.machineId}) in ${where}\n  ${session.status}${session.statusDetail ? `: ${session.statusDetail}` : ''}, active ${ago(session.lastActivityAt)}, ${flags.join(', ')}${session.title ? `\n  title: ${session.title}` : ''}`
}

async function listSessions(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const machine = optionalStr(input.machine)
  const machineId = machine ? (await ctx.machines.open(machine)).info.id : null
  const { sessions, errors } = await ctx.services.seal.sessions.list()
  const shown = sessions.filter(
    (session) =>
      (!machineId || session.machineId === machineId) &&
      (input.include_done === true || session.status !== 'done')
  )
  const notes = errors.length
    ? `\n\nMachines that could not be scanned:\n- ${errors.join('\n- ')}`
    : ''
  if (shown.length === 0) {
    return ok(
      `No ${input.include_done === true ? '' : 'active '}agent sessions${machineId ? ` on ${machineId}` : ''}.${notes}`
    )
  }
  return ok(`${shown.map(sessionLine).join('\n')}${notes}`)
}

async function findSession(
  ctx: HomeChatToolContext,
  sessionId: string
): Promise<HomeChatSessionSummary> {
  const { sessions } = await ctx.services.seal.sessions.list()
  const session = sessions.find((candidate) => candidate.id === sessionId.trim())
  if (!session) {
    throw new Error(
      `No session ${sessionId}. Call list_sessions (include_done to see finished ones) and use an id from it.`
    )
  }
  return session
}

async function messageSession(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const session = await findSession(ctx, str(input.session_id))
  const sent = await ctx.services.seal.sessions.send(session.id, str(input.text))
  if (sent.state === 'failed') {
    return failed(
      `The message did not reach ${session.id}: ${sent.error ?? 'unknown reason'}. Check the session with list_sessions; a session whose process is gone can be continued with start_session instead.`
    )
  }
  const how = sent.route ? ` through its ${sent.route}` : ''
  return ok(
    sent.state === 'delivered'
      ? `Delivered to ${session.id}${how}; it is in the session's transcript. Read its answer with read_session.`
      : `Handed to ${session.id}${how} (${sent.state}). It will show in the transcript once the session picks it up; read_session shows the answer.`,
    session.machineLabel
  )
}

function hostArgs(info: HomeChatMachineInfo): string[] {
  const host = info.executionHostId ?? info.id
  const parsed = parseExecutionHostId(host)
  if (parsed?.kind === 'runtime') {
    return ['--environment', parsed.environmentId]
  }
  return host === LOCAL_MACHINE_ID ? [] : ['--host', host]
}

async function startSession(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const worktree = optionalStr(input.worktree)
  const project = optionalStr(input.project)
  if (!worktree && !project) {
    return failed(
      'start_session needs worktree (an existing workspace) or project (to create a new worktree). Find them with seal_cli ["worktree", "list", "--json"] or ["project", "list", "--json"].'
    )
  }
  const machine = await ctx.machines.open(optionalStr(input.machine) ?? LOCAL_MACHINE_ID)
  if (machine.info.kind === 'hop') {
    return failed(
      `${machine.info.label} is reached through another machine, so Seal cannot host agent sessions on it. Use run_command there, or add it as an SSH host on the Machines page.`
    )
  }
  const agent = optionalStr(input.agent) ?? 'claude'
  const prompt = str(input.prompt)
  const args = worktree
    ? ['agent', 'launch', '--agent', agent, '--worktree', worktree, '--prompt', prompt]
    : [
        'worktree',
        'create',
        '--project',
        str(project),
        '--name',
        optionalStr(input.name) ?? `assistant-${randomUUID().slice(0, 6)}`,
        '--agent',
        agent,
        '--prompt',
        prompt
      ]
  const result = await ctx.runOrcaCli([...args, ...hostArgs(machine.info), '--json'], {
    timeoutMs: 10 * 60_000,
    signal: ctx.signal
  })
  if (result.exitCode !== 0) {
    return failed(
      `Seal could not start the session on ${machine.info.label}: ${(result.stderr || result.stdout).trim().slice(0, 2_000) || `exit code ${result.exitCode}`}`
    )
  }
  const handle = agentTerminalHandle(parseOrcaJson(result.stdout))
  return ok(
    `Started a ${agent} session on ${machine.info.label}${handle ? ` (terminal ${handle})` : ''}. It appears in list_sessions once the agent is up; read it with read_session and steer it with message_session.`,
    machine.info.label
  )
}

function catalogText(label: string, entries: readonly HomeChatCatalogEntry[]): string {
  if (entries.length === 0) {
    return `No skills or instruction files found on ${label}.`
  }
  const section = (title: string, kind: HomeChatCatalogEntry['kind']): string[] => {
    const rows = entries.filter((entry) => entry.kind === kind)
    return rows.length
      ? [
          `${title}:`,
          ...rows.map((entry) =>
            kind === 'instructions'
              ? `- ${entry.path} (${entry.bytes} bytes)`
              : `- ${entry.name}: ${entry.description.slice(0, 200) || '(no description)'}\n  ${entry.path}`
          )
        ]
      : []
  }
  return [
    `On ${label}:`,
    ...section('Skills (load with load_skill and this machine)', 'skill'),
    ...section('Agent definitions (load with load_skill)', 'agent'),
    ...section('Prompts (load with load_skill)', 'prompt'),
    ...section('Instruction files (read with read_file before working there)', 'instructions')
  ].join('\n')
}

export async function executeSealTool(
  tool: HomeChatSealToolName,
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const { seal, skills } = ctx.services
  switch (tool) {
    case 'list_sessions':
      return listSessions(input, ctx)
    case 'read_session': {
      const session = await findSession(ctx, str(input.session_id))
      const limit = typeof input.limit === 'number' ? input.limit : 20
      return ok(
        clipToolText(await seal.sessions.transcript(session.id, limit)),
        session.machineLabel
      )
    }
    case 'message_session':
      return messageSession(input, ctx)
    case 'take_over_session': {
      const session = await findSession(ctx, str(input.session_id))
      if (!session.canTakeOver) {
        return failed(
          session.origin === 'seal'
            ? `${session.id} already runs in a Seal pane; message it with message_session.`
            : `${session.id} cannot be taken over yet: Seal has not seen its transcript. Send it a message first, then try again.`
        )
      }
      seal.open({ kind: 'take-over', sessionId: session.id })
      return ok(
        `Asked Seal's window to stop the external process and reopen ${session.id} in a Seal pane. That needs a workspace open in Seal on ${session.machineLabel}; without one, Seal tells the user and the session stays as it is. Confirm with list_sessions: it should now show "in a Seal pane".`,
        session.machineLabel
      )
    }
    case 'start_session':
      return startSession(input, ctx)
    case 'account_usage':
      return ok(
        await seal.accounts.usage(
          input.provider === 'claude' || input.provider === 'codex' ? input.provider : undefined,
          input.refresh === true
        )
      )
    case 'switch_account':
      return ok(
        await seal.accounts.swap(
          input.provider === 'codex' ? 'codex' : 'claude',
          str(input.account)
        )
      )
    case 'open_in_seal': {
      const target = str(input.target)
      const id = optionalStr(input.id)
      if (target === 'machine') {
        const machine = await ctx.machines.open(id ?? LOCAL_MACHINE_ID)
        seal.open({ kind: 'machine', machineId: machine.info.id })
        return ok(`Showing ${machine.info.label} on the Machines page.`, machine.info.label)
      }
      if (target === 'thread') {
        if (!id) {
          return failed('open_in_seal target "thread" needs id (the thread id).')
        }
        seal.open({ kind: 'thread', chatId: id })
        return ok('Showing that thread.')
      }
      if (!OPEN_VIEWS.has(target)) {
        return failed(`Unknown target "${target}".`)
      }
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: membership in OPEN_VIEWS was just checked.
      seal.open({ kind: 'view', view: target as HomeChatOpenView })
      return ok(`Showing ${target} in Seal.`)
    }
    case 'list_skills': {
      const machine = await ctx.machines.open(optionalStr(input.machine) ?? LOCAL_MACHINE_ID)
      const catalog = await skills.machineCatalog(machine, optionalStr(input.project_path), true)
      return ok(clipToolText(catalogText(machine.info.label, catalog.entries)), machine.info.label)
    }
    case 'load_skill': {
      const machine = await ctx.machines.open(optionalStr(input.machine) ?? LOCAL_MACHINE_ID)
      return ok(clipToolText(await skills.load(str(input.name), machine)), machine.info.label)
    }
  }
}
