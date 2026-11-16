import type { AgentStatusState } from '../../shared/agent-status/contracts/agent-status-types'
import { agentSessionAdapter } from '../../shared/live-sessions/adapters/agent-session-adapters'
import { liveSessionSurfaceOf } from '../../shared/live-sessions/live-session-surface'
import type {
  AgentSessionSurface,
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
import { isNotificationSourceEnabled } from '../../shared/notification-source-gate'
import { liveSessionLabel } from '../../shared/session-recap/live-session-label'
import {
  liveSessionNotice,
  type LiveSessionNotice
} from '../../shared/live-sessions/live-session-notices'

export type LiveSessionNotification = {
  sessionId: string
  kind: LiveSessionNotice
  title: string
  body: string
}

export type LiveSessionNotifierDeps = {
  /** The user wants this kind of notice, and is not already looking at Seal. */
  wanted: (kind: LiveSessionNotice) => boolean
  show: (notification: LiveSessionNotification) => void
}

export type LiveSessionNotificationOwner =
  | 'structured-attention'
  | 'agent-hooks'
  | 'live-session-notifier'

const OWNER_BY_SURFACE: Record<AgentSessionSurface['kind'], LiveSessionNotificationOwner> = {
  chat: 'structured-attention',
  cli: 'agent-hooks',
  external: 'live-session-notifier'
}

/** The one producer that notifies for a session: whoever owns the surface it runs on. */
export function liveSessionNotificationOwner(
  session: Pick<LiveSession, 'surface' | 'inputRoutes'>
): LiveSessionNotificationOwner {
  return OWNER_BY_SURFACE[liveSessionSurfaceOf(session).kind]
}

/** A notice as the agent state the hook and structured lanes report, so one gate reads all three. */
const NOTICE_AGENT_STATE: Record<LiveSessionNotice, AgentStatusState> = {
  'needs-attention': 'waiting',
  finished: 'done'
}

/** "Agent needs input" and "Agent task complete" decide for external sessions as they do in Seal. */
export function isLiveSessionNoticeEnabled(
  settings: Parameters<typeof isNotificationSourceEnabled>[0],
  kind: LiveSessionNotice
): boolean {
  return isNotificationSourceEnabled(settings, 'agent-task-complete', NOTICE_AGENT_STATE[kind])
}

function describe(session: LiveSession, kind: LiveSessionNotice): LiveSessionNotification {
  const agent = agentSessionAdapter(session.provider)?.label ?? session.provider
  const name = liveSessionLabel(session) ?? agent
  const where = `${agent} on ${session.machine.label}`
  const detail =
    kind === 'finished'
      ? session.lastMessage
      : (session.permission?.question ?? session.statusDetail ?? session.lastMessage)
  let lead = `${where} finished`
  if (kind === 'needs-attention') {
    lead = session.status === 'errored' ? `${where} hit an error` : `${where} needs you`
  }
  return { sessionId: session.id, kind, title: name, body: detail ? `${lead}: ${detail}` : lead }
}

/** Tells the user when a session Seal watches starts needing them or finishes its turn. */
export class LiveSessionNotifier {
  private readonly known = new Map<string, LiveSession>()

  constructor(private readonly deps: LiveSessionNotifierDeps) {}

  onEvent(event: LiveSessionRegistryEvent): void {
    if (event.type === 'snapshot') {
      this.known.clear()
      for (const session of event.snapshot.sessions) {
        this.known.set(session.id, session)
      }
    } else if (event.type === 'remove') {
      const gone = this.known.get(event.sessionId)
      this.known.delete(event.sessionId)
      if (gone && event.replacedBy && !this.known.has(event.replacedBy)) {
        this.known.set(event.replacedBy, gone)
      }
    } else if (event.type === 'upsert') {
      const before = this.known.get(event.session.id)
      this.known.set(event.session.id, event.session)
      const mine = liveSessionNotificationOwner(event.session) === 'live-session-notifier'
      const kind = mine ? liveSessionNotice(before, event.session) : null
      if (kind && this.deps.wanted(kind)) {
        this.deps.show(describe(event.session, kind))
      }
    }
  }
}
