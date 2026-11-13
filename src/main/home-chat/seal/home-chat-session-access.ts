import { randomUUID } from 'node:crypto'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionRegistrySnapshot,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { isRecord } from '../home-chat-record-guard'
import type { HomeChatRuntimeSource } from '../machines/home-chat-runtime-machine'

const RUNTIME_CALL_TIMEOUT_MS = 30_000
const MAX_MESSAGE_CHARS = 1_500

export type HomeChatSessionSummary = {
  id: string
  agent: string
  /** Seal machine id: `local`, `ssh:<id>` or `runtime:<id>`. */
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

/** The agent sessions Seal tracks, on this desktop's hosts and on paired Seal servers. */
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

const RUNTIME_ID = /^runtime:([^/]+)\/(.+)$/

function summarize(session: LiveSession, machineId: string, idPrefix = ''): HomeChatSessionSummary {
  return {
    id: `${idPrefix}${session.id}`,
    agent: session.provider,
    machineId,
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

function isSnapshot(value: unknown): value is LiveSessionRegistrySnapshot {
  return isRecord(value) && Array.isArray(value.sessions)
}

function isTranscriptPage(value: unknown): value is LiveTranscriptPage {
  return isRecord(value) && Array.isArray(value.messages)
}

function isLiveMessage(value: unknown): value is LiveMessage {
  return isRecord(value) && typeof value.state === 'string'
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
  runtimes: HomeChatRuntimeSource | null
}): HomeChatSessionAccess {
  const requireLive = (): HomeChatLiveSessions => {
    const live = deps.live()
    if (!live) {
      throw new Error('Seal is still starting its session tracker; try again in a moment.')
    }
    return live
  }
  const runtime = (sessionId: string): { environmentId: string; id: string } | null => {
    const match = RUNTIME_ID.exec(sessionId)
    return match ? { environmentId: match[1], id: match[2] } : null
  }
  const callRuntime = (
    environmentId: string,
    method: string,
    params: unknown
  ): Promise<unknown> => {
    if (!deps.runtimes) {
      throw new Error('Paired Seal servers are not available here.')
    }
    return deps.runtimes.call(environmentId, method, params, RUNTIME_CALL_TIMEOUT_MS)
  }

  return {
    list: async () => {
      const sessions: HomeChatSessionSummary[] = []
      const errors: string[] = []
      const live = deps.live()
      if (live) {
        await live.refresh().catch(() => undefined)
        const snapshot = live.snapshot()
        sessions.push(
          ...snapshot.sessions.map((session) =>
            summarize(
              session,
              session.machine.kind === 'ssh' ? `ssh:${session.machine.hostId}` : 'local'
            )
          )
        )
        errors.push(
          ...Object.entries(snapshot.hostErrors).map(([host, error]) => `${host}: ${error}`)
        )
      }
      const online = new Set(
        (deps.runtimes?.statuses() ?? [])
          .filter((snapshot) => snapshot.transport === 'ready')
          .map((snapshot) => snapshot.environmentId)
      )
      // A server also reachable over SSH is already covered by this desktop's own scan of that host.
      const servers = (deps.runtimes?.environments() ?? []).filter(
        (environment) => online.has(environment.id) && !environment.sshAccess
      )
      await Promise.all(
        servers.map(async (environment) => {
          try {
            const snapshot = await callRuntime(environment.id, 'liveSessions.list', undefined)
            if (isSnapshot(snapshot)) {
              sessions.push(
                ...snapshot.sessions.map((session) => ({
                  ...summarize(session, `runtime:${environment.id}`, `runtime:${environment.id}/`),
                  machineLabel: environment.name
                }))
              )
            }
          } catch (error) {
            errors.push(
              `${environment.name}: ${error instanceof Error ? error.message : String(error)}`
            )
          }
        })
      )
      return { sessions: sessions.sort((a, b) => b.lastActivityAt - a.lastActivityAt), errors }
    },
    transcript: async (sessionId, limit) => {
      const remote = runtime(sessionId)
      const page = remote
        ? await callRuntime(remote.environmentId, 'liveSessions.transcript', {
            sessionId: remote.id,
            limit
          })
        : await requireLive().transcriptPage(sessionId, null, limit)
      if (!isTranscriptPage(page)) {
        throw new Error('The session returned an unreadable transcript')
      }
      return renderSessionTranscript(page.messages)
    },
    send: async (sessionId, text) => {
      const remote = runtime(sessionId)
      const messageId = randomUUID()
      if (remote) {
        const sent = await callRuntime(remote.environmentId, 'liveSessions.send', {
          sessionId: remote.id,
          messageId,
          text
        })
        if (!isLiveMessage(sent)) {
          throw new Error('The Seal server returned an unreadable delivery result')
        }
        return delivery(sent)
      }
      return delivery(await requireLive().send({ sessionId, messageId, text }))
    }
  }
}
