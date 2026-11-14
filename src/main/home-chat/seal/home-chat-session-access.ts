import { randomUUID } from 'node:crypto'
import { liveSessionMachineId } from '../../../shared/live-sessions/live-session-machine-id'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionRegistrySnapshot,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'

const MAX_MESSAGE_CHARS = 1_500

export type HomeChatSessionSummary = {
  id: string
  agent: string
  /** Seal machine id: `local` or `machine:<id>`. */
  machineId: string
  machineLabel: string
  /** Runs in a Seal pane, or was found running outside Seal. */
  origin: 'seal' | 'external'
  project: string | null
  cwd: string | null
  title: string | null
  status: string
  statusDetail: string | null
  lastActivityAt: number
  alive: boolean
  canTakeOver: boolean
}

export type HomeChatSessionDelivery = {
  state: LiveMessage['state']
  route: LiveMessage['route']
  error: string | null
}

/** The agent sessions Seal tracks: on this computer, SSH hosts and paired Seal servers. */
export type HomeChatSessionAccess = {
  list: () => Promise<{ sessions: HomeChatSessionSummary[]; errors: string[] }>
  transcript: (sessionId: string, limit: number) => Promise<string>
  send: (sessionId: string, text: string) => Promise<HomeChatSessionDelivery>
}

/** The slice of the live-session service the assistant uses. */
export type HomeChatLiveSessions = {
  snapshot: () => LiveSessionRegistrySnapshot
  refresh: () => Promise<void>
  transcriptPage: (sessionId: string, before: null, limit?: number) => Promise<LiveTranscriptPage>
  send: (request: { sessionId: string; messageId: string; text: string }) => Promise<LiveMessage>
}

function summarize(session: LiveSession): HomeChatSessionSummary {
  return {
    id: session.id,
    agent: session.provider,
    machineId: liveSessionMachineId(session.machine),
    machineLabel: session.machine.label,
    origin: session.origin,
    project: session.project,
    cwd: session.cwd,
    title: session.title,
    status: session.status,
    statusDetail: session.statusDetail,
    lastActivityAt: session.lastActivityAt,
    alive: session.alive,
    canTakeOver: session.origin === 'external' && !session.providerSessionId.startsWith('pid-')
  }
}

function blockText(block: NativeChatMessage['blocks'][number]): string {
  if (block.type === 'text') {
    return block.text
  }
  return block.type === 'tool-call' ? `[ran ${block.name}]` : ''
}

export function renderSessionTranscript(messages: readonly NativeChatMessage[]): string {
  const lines = messages.flatMap((message) => {
    const text = message.blocks.map(blockText).filter(Boolean).join('\n').trim()
    if (!text) {
      return []
    }
    const clipped =
      text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS)} ...` : text
    return [`${message.role}: ${clipped}`]
  })
  return lines.join('\n\n') || 'The transcript has no readable messages yet.'
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
    transcript: async (sessionId, limit) =>
      renderSessionTranscript(
        (await requireLive().transcriptPage(sessionId, null, limit)).messages
      ),
    send: async (sessionId, text) =>
      delivery(await requireLive().send({ sessionId, messageId: randomUUID(), text }))
  }
}
