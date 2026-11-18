import type { HomeChatOpenView } from '../../../shared/home-chat/home-chat-types'
import { isLiveSessionPlaceInProject } from '../../../shared/live-sessions/live-session-workspace-groups'
import { LOCAL_MACHINE_ID } from '../machines/home-chat-machine-types'
import type { HomeChatSessionSummary } from '../seal/home-chat-session-access'
import type { HomeChatCatalogEntry } from '../skills/home-chat-machine-catalog'
import { startSession } from './home-chat-session-start'
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

const SURFACE_WORDS: Record<HomeChatSessionSummary['surface'], string> = {
  chat: 'a Seal chat',
  cli: 'in a Seal pane',
  external: 'outside Seal'
}

function sessionLine(session: HomeChatSessionSummary): string {
  const flags = [
    SURFACE_WORDS[session.surface],
    // A chat at rest has no process: its host starts the agent again with the next message.
    session.alive || session.surface === 'chat' ? null : 'process not running',
    session.canTakeOver ? 'can be taken over' : null
  ].filter(Boolean)
  const place = [
    session.place.project ? `project: ${session.place.project}` : null,
    session.worktreeId ? `workspace: worktree:${session.worktreeId}` : null
  ].filter(Boolean)
  const asks = session.permission
    ? `\n  asks: ${session.permission.question} (prompt ${session.permission.promptId}; options: ${session.permission.options.map((option) => `${option.id} = ${option.label}`).join(', ')})`
    : ''
  return `- ${session.id}\n  ${session.agent} on ${session.machineLabel} (${session.machineId}) in ${session.cwd ?? 'unknown folder'}\n  ${session.status}${session.statusDetail ? `: ${session.statusDetail}` : ''}, active ${ago(session.lastActivityAt)}, ${flags.join(', ')}${place.length ? `\n  ${place.join(', ')}` : ''}${session.title ? `\n  title: ${session.title}` : ''}${asks}`
}

async function listSessions(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const machine = optionalStr(input.machine)
  const machineId = machine ? (await ctx.machines.open(machine)).info.id : null
  const project = optionalStr(input.project)
  const { sessions, errors } = await ctx.services.seal.sessions.list()
  const shown = sessions.filter(
    (session) =>
      (!machineId || session.machineId === machineId) &&
      (!project || isLiveSessionPlaceInProject(session.place, project)) &&
      (input.include_done === true || session.active)
  )
  const notes = errors.length
    ? `\n\nMachines that could not be scanned:\n- ${errors.join('\n- ')}`
    : ''
  if (shown.length === 0) {
    return ok(
      `No ${input.include_done === true ? '' : 'active '}agent sessions${machineId ? ` on ${machineId}` : ''}${project ? ` in project ${project}` : ''}.${notes}`
    )
  }
  return ok(`${shown.map(sessionLine).join('\n')}${notes}`)
}

async function findSession(
  ctx: HomeChatToolContext,
  sessionId: string
): Promise<HomeChatSessionSummary> {
  const access = ctx.services.seal.sessions
  const id = access.currentId(sessionId.trim())
  const session = (await access.list()).sessions.find((candidate) => candidate.id === id)
  if (!session) {
    throw new Error(
      `No session ${sessionId}. Call list_sessions (include_done to see finished ones) and use an id from it.`
    )
  }
  return session
}

async function readSession(
  input: Record<string, unknown>,
  ctx: HomeChatToolContext
): Promise<HomeChatToolResult> {
  const session = await findSession(ctx, str(input.session_id))
  const latestTurn = input.latest_turn === true
  const page = await ctx.services.seal.sessions.transcript(session.id, {
    limit: typeof input.limit === 'number' ? input.limit : 20,
    before: typeof input.before === 'number' ? input.before : null,
    latestTurn,
    fullText: input.full_text === true
  })
  const older = !page.more
    ? 'This reaches the start of the transcript.'
    : latestTurn
      ? 'Earlier turns: read_session without latest_turn.'
      : `Older messages: read_session with before ${page.start}.`
  return ok(
    clipToolText(
      `${sessionLine(session).slice(2)}\n\n${latestTurn ? 'Latest turn' : 'Transcript'}, oldest first. ${older}\n\n${page.text}`
    ),
    session.machineLabel
  )
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
  const how =
    sent.route === 'structured'
      ? ' as a chat message'
      : sent.route
        ? ` through its ${sent.route}`
        : ''
  return ok(
    sent.state === 'delivered'
      ? `Delivered to ${session.id}${how}; it is in the session's transcript. Read its answer with read_session.`
      : `Handed to ${session.id}${how} (${sent.state}). It will show in the transcript once the session picks it up; read_session shows the answer.`,
    session.machineLabel
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
    case 'read_session':
      return readSession(input, ctx)
    case 'message_session':
      return messageSession(input, ctx)
    case 'take_over_session': {
      const session = await findSession(ctx, str(input.session_id))
      if (!session.canTakeOver) {
        return failed(
          session.surface === 'external'
            ? `${session.id} cannot be taken over yet: Seal has not seen its transcript. Send it a message first, then try again.`
            : `${session.id} already runs ${session.surface === 'chat' ? 'as a Seal chat' : 'in a Seal pane'}; message it with message_session.`
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
