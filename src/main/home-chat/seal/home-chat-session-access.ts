import { randomUUID } from 'node:crypto'
import { liveSessionMachineId } from '../../../shared/live-sessions/live-session-machine-id'
import { isActiveLiveSession } from '../../../shared/live-sessions/live-session-status'
import type {
  AgentSessionSurface,
  LiveMessage,
  LiveSession,
  LiveSessionPermissionPrompt,
  LiveSessionRegistrySnapshot,
  LiveSessionStatus,
  LiveTranscriptCursor,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import {
  liveSessionPlaceOf,
  type LiveSessionPlace
} from '../../../shared/live-sessions/live-session-workspace-groups'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'

const MAX_MESSAGE_CHARS = 1_500
/** How long a send waits to learn whether the message reached the session or failed. */
const SEND_SETTLE_MS = 20_000
const SEND_POLL_MS = 200
/** How far back a latest-turn read looks for the message that started the turn. */
const MAX_TURN_PAGES = 10

export type HomeChatSessionSummary = {
  id: string
  agent: string
  /** Seal machine id: `local` or `machine:<id>`. */
  machineId: string
  machineLabel: string
  /** A Seal chat, an agent in a Seal pane, or a session found running outside Seal. */
  surface: AgentSessionSurface['kind']
  /** A Seal chat's own session id, as `agent launch` reports it. */
  chatSessionId: string | null
  cwd: string | null
  /** The project and workspace it is listed under, as `seal sessions list` shows them. */
  place: LiveSessionPlace
  /** The Seal workspace its registry linked it to; null when it is listed by its folder. */
  worktreeId: string | null
  title: string | null
  status: LiveSessionStatus
  statusDetail: string | null
  lastActivityAt: number
  /** Still running, or a chat that takes the next message: what a list shows by default. */
  active: boolean
  /** Its agent process runs; a chat at rest has none. */
  alive: boolean
  canTakeOver: boolean
  /** The question it waits on while `needs-permission`, with the options that answer it. */
  permission: LiveSessionPermissionPrompt | null
}

export type HomeChatTranscriptRead = {
  limit: number
  /** Read the messages before this offset: a page's `start`, to page back. Null reads the newest. */
  before: LiveTranscriptCursor | null
  /** Only the newest turn: the last user message and everything after it. */
  latestTurn: boolean
  /** Keep long messages whole instead of shortening each one. */
  fullText: boolean
}

export type HomeChatTranscriptExcerpt = {
  text: string
  /** Offset of the oldest message shown; pass as `before` to read further back. */
  start: LiveTranscriptCursor
  /** Older messages exist before `start`. */
  more: boolean
}

export type HomeChatSessionDelivery = {
  state: LiveMessage['state']
  route: LiveMessage['route']
  error: string | null
}

/** The agent sessions Seal tracks: on this computer, SSH hosts and paired Seal servers. */
export type HomeChatSessionAccess = {
  list: () => Promise<{ sessions: HomeChatSessionSummary[]; errors: string[] }>
  /** The id a session goes by now: a new chat or agent gets another once its agent names it. */
  currentId: (sessionId: string) => string
  transcript: (
    sessionId: string,
    read: HomeChatTranscriptRead
  ) => Promise<HomeChatTranscriptExcerpt>
  send: (sessionId: string, text: string) => Promise<HomeChatSessionDelivery>
}

/** The slice of the live-session service the assistant uses. */
export type HomeChatLiveSessions = {
  registry: { currentId: (sessionId: string) => string }
  snapshot: () => LiveSessionRegistrySnapshot
  refresh: () => Promise<void>
  transcriptPage: (
    sessionId: string,
    before: LiveTranscriptCursor | null,
    limit?: number
  ) => Promise<LiveTranscriptPage>
  send: (request: { sessionId: string; messageId: string; text: string }) => Promise<LiveMessage>
  messages: (sessionId?: string) => LiveMessage[]
}

function summarize(session: LiveSession): HomeChatSessionSummary {
  return {
    id: session.id,
    agent: session.provider,
    machineId: liveSessionMachineId(session.machine),
    machineLabel: session.machine.label,
    surface: session.surface.kind,
    chatSessionId: session.surface.kind === 'chat' ? session.surface.sessionId : null,
    cwd: session.cwd,
    place: liveSessionPlaceOf(session),
    worktreeId: session.workspace?.worktreeId ?? null,
    title: session.title,
    status: session.status,
    statusDetail: session.statusDetail,
    lastActivityAt: session.lastActivityAt,
    active: isActiveLiveSession(session),
    alive: session.alive,
    canTakeOver: session.capabilities.takeOver,
    permission: session.status === 'needs-permission' ? session.permission : null
  }
}

function blockText(block: NativeChatMessage['blocks'][number]): string {
  if (block.type === 'text') {
    return block.text
  }
  return block.type === 'tool-call' ? `[ran ${block.name}]` : ''
}

function renderSessionTranscript(
  messages: readonly NativeChatMessage[],
  fullText: boolean
): string {
  const lines = messages.flatMap((message) => {
    const text = message.blocks.map(blockText).filter(Boolean).join('\n').trim()
    if (!text) {
      return []
    }
    const clipped =
      !fullText && text.length > MAX_MESSAGE_CHARS
        ? `${text.slice(0, MAX_MESSAGE_CHARS)} ...`
        : text
    return [`${message.role}: ${clipped}`]
  })
  return lines.join('\n\n') || 'The transcript has no readable messages here.'
}

const isUserTurnStart = (message: NativeChatMessage): boolean =>
  message.role === 'user' && message.blocks.some((block) => block.type === 'text')

/** The newest turn: pages back from `before` until the user message that started it. */
async function readLatestTurn(
  live: HomeChatLiveSessions,
  sessionId: string,
  read: HomeChatTranscriptRead
): Promise<{ messages: NativeChatMessage[]; start: LiveTranscriptCursor; more: boolean }> {
  let messages: NativeChatMessage[] = []
  let page = await live.transcriptPage(sessionId, read.before, read.limit)
  for (let pages = 1; ; pages++) {
    messages = [...page.messages, ...messages]
    const from = messages.findLastIndex(isUserTurnStart)
    if (from !== -1) {
      return { messages: messages.slice(from), start: page.start, more: from > 0 || page.more }
    }
    if (!page.more || pages >= MAX_TURN_PAGES) {
      return { messages, start: page.start, more: page.more }
    }
    page = await live.transcriptPage(sessionId, page.start, read.limit)
  }
}

function delivery(message: LiveMessage): HomeChatSessionDelivery {
  return { state: message.state, route: message.route, error: message.error }
}

export function createHomeChatSessionAccess(deps: {
  live: () => HomeChatLiveSessions | null
}): HomeChatSessionAccess {
  const requireLive = (): HomeChatLiveSessions => {
    const live = deps.live()
    if (!live) {
      throw new Error('Seal is still starting its session tracker; try again in a moment.')
    }
    return live
  }

  return {
    list: async () => {
      const live = deps.live()
      if (!live) {
        return { sessions: [], errors: [] }
      }
      await live.refresh().catch(() => undefined)
      const snapshot = live.snapshot()
      return {
        sessions: snapshot.sessions
          .map(summarize)
          .sort((a, b) => b.lastActivityAt - a.lastActivityAt),
        errors: Object.entries(snapshot.hostErrors).map(([host, error]) => `${host}: ${error}`)
      }
    },
    currentId: (sessionId) => deps.live()?.registry.currentId(sessionId) ?? sessionId,
    transcript: async (sessionId, read) => {
      const live = requireLive()
      const page = read.latestTurn
        ? await readLatestTurn(live, sessionId, read)
        : await live.transcriptPage(sessionId, read.before, read.limit)
      return {
        text: renderSessionTranscript(page.messages, read.fullText),
        start: page.start,
        more: page.more
      }
    },
    send: async (sessionId, text) => {
      const live = requireLive()
      let message = await live.send({ sessionId, messageId: randomUUID(), text })
      // The outbox answers before it has tried: wait for the attempt, so a failure is reported as one.
      const deadline = Date.now() + SEND_SETTLE_MS
      while ((message.state === 'queued' || message.state === 'sending') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, SEND_POLL_MS))
        message =
          live.messages().find((candidate) => candidate.messageId === message.messageId) ?? message
      }
      return delivery(message)
    }
  }
}
