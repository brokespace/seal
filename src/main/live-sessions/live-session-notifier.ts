import type { AgentStatusState } from '../../shared/agent-status/contracts/agent-status-types'
import { agentSessionAdapter } from '../../shared/live-sessions/adapters/agent-session-adapters'
import { liveSessionStatusGroup } from '../../shared/live-sessions/live-session-status'
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
import { unrefTimer } from '../session-summaries/unref-timer'

export type LiveSessionNotification = {
  sessionId: string
  kind: LiveSessionNotice
  title: string
  body: string
  /** The session's surface, which decides what a click opens. */
  surface: AgentSessionSurface
}

/** Whether a finished turn's reply asks the user something, as far as is known yet. */
export type ReplyAskVerdict = 'asks' | 'tells' | 'deciding'

export type LiveSessionNotifierDeps = {
  /** The user wants this kind of notice from this surface, and is not already looking at Seal. */
  wanted: (kind: LiveSessionNotice, surface: AgentSessionSurface) => boolean
  show: (notification: LiveSessionNotification) => void
  /** Absent where nothing reads replies: every finished turn is then announced at once. */
  replyAsk?: (session: LiveSession) => ReplyAskVerdict
  /** The reply a session relabelled as asking ended on, for one whose row carries none. */
  askedReply?: (sessionId: string) => string | null
  setTimer?: typeof unrefTimer
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

function describe(
  session: LiveSession,
  kind: LiveSessionNotice,
  askedReply: string | null
): LiveSessionNotification {
  const agent = agentSessionAdapter(session.provider)?.label ?? session.provider
  const name = liveSessionLabel(session) ?? agent
  const where = `${agent} on ${session.machine.label}`
  const detail =
    kind === 'finished'
      ? session.lastMessage
      : (session.permission?.question ?? session.statusDetail ?? session.lastMessage ?? askedReply)
  let lead = `${where} finished`
  if (kind === 'needs-attention') {
    lead = session.status === 'errored' ? `${where} hit an error` : `${where} needs you`
  }
  return {
    sessionId: session.id,
    kind,
    title: name,
    body: detail ? `${lead}: ${detail}` : lead,
    surface: liveSessionSurfaceOf(session)
  }
}

/** How long a finished turn waits, check by check, for its reply to be read. */
const REPLY_CHECKS_MS = [300, 700, 1_500, 3_000, 5_000, 8_000]

/** Only the registry reads a reply as a question, so no owner of a surface has announced it. */
function askedAfterTurnEnd(before: LiveSession | undefined, after: LiveSession): boolean {
  return (
    before?.status === 'your-turn' &&
    after.status === 'waiting-input' &&
    after.statusSource === 'classifier'
  )
}

/**
 * Tells the user when a session Seal watches starts needing them or finishes its turn. A turn that
 * ends on a reply still being read is announced once the reading says which of the two it is.
 */
export class LiveSessionNotifier {
  private readonly known = new Map<string, LiveSession>()
  /** Finished turns not announced yet, with the cancel of their next check. */
  private readonly held = new Map<string, () => void>()
  private readonly setTimer: NonNullable<LiveSessionNotifierDeps['setTimer']>

  constructor(private readonly deps: LiveSessionNotifierDeps) {
    this.setTimer = deps.setTimer ?? unrefTimer
  }

  onEvent(event: LiveSessionRegistryEvent): void {
    if (event.type === 'snapshot') {
      this.dispose()
      this.known.clear()
      for (const session of event.snapshot.sessions) {
        this.known.set(session.id, session)
      }
    } else if (event.type === 'remove') {
      const gone = this.known.get(event.sessionId)
      this.known.delete(event.sessionId)
      const unannounced = this.unhold(event.sessionId)
      if (gone && event.replacedBy) {
        if (!this.known.has(event.replacedBy)) {
          this.known.set(event.replacedBy, gone)
        }
        if (unannounced) {
          this.announce(gone, 'finished')
        }
      }
    } else if (event.type === 'upsert') {
      const before = this.known.get(event.session.id)
      this.known.set(event.session.id, event.session)
      this.changed(before, event.session)
    }
  }

  dispose(): void {
    for (const cancel of this.held.values()) {
      cancel()
    }
    this.held.clear()
  }

  private changed(before: LiveSession | undefined, session: LiveSession): void {
    if (liveSessionNotificationOwner(session) !== 'live-session-notifier') {
      if (askedAfterTurnEnd(before, session)) {
        this.announce(session, 'needs-attention')
      }
      return
    }
    const kind = liveSessionNotice(before, session)
    if (this.held.has(session.id)) {
      if (before?.status === session.status) {
        return
      }
      this.unhold(session.id)
      // A question or an error says more than the end it follows; new work makes that end old news.
      if (!kind && liveSessionStatusGroup(session.status) !== 'working') {
        this.announce(session, 'finished')
      }
    }
    if (kind === 'finished' && this.deps.replyAsk?.(session) === 'deciding') {
      this.hold(session.id, 0)
    } else if (kind) {
      this.announce(session, kind)
    }
  }

  private hold(sessionId: string, check: number): void {
    this.held.set(
      sessionId,
      this.setTimer(() => this.read(sessionId, check), REPLY_CHECKS_MS[check]).cancel
    )
  }

  private unhold(sessionId: string): boolean {
    this.held.get(sessionId)?.()
    return this.held.delete(sessionId)
  }

  private read(sessionId: string, check: number): void {
    this.held.delete(sessionId)
    const session = this.known.get(sessionId)
    if (!session) {
      return
    }
    const verdict = this.deps.replyAsk?.(session) ?? 'tells'
    if (verdict === 'deciding' && check + 1 < REPLY_CHECKS_MS.length) {
      this.hold(sessionId, check + 1)
    } else if (verdict === 'asks') {
      const asking: LiveSession = {
        ...session,
        status: 'waiting-input',
        statusSource: 'classifier'
      }
      // The registry publishes the question next; it is no news by then.
      this.known.set(sessionId, asking)
      this.announce(asking, 'needs-attention')
    } else {
      this.announce(session, 'finished')
    }
  }

  private announce(session: LiveSession, kind: LiveSessionNotice): void {
    if (this.deps.wanted(kind, liveSessionSurfaceOf(session))) {
      // A chat's row carries no reply; the one read for the question stands in.
      const askedReply =
        session.statusSource === 'classifier' ? this.deps.askedReply?.(session.id) : null
      this.deps.show(describe(session, kind, askedReply ?? null))
    }
  }
}
