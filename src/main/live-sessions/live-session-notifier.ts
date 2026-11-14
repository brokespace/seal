import type {
  LiveSession,
  LiveSessionRegistryEvent
} from '../../shared/live-sessions/live-session-types'
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
  /** The user wants these, and is not already looking at Seal. */
  wanted: () => boolean
  show: (notification: LiveSessionNotification) => void
}

function describe(session: LiveSession, kind: LiveSessionNotice): LiveSessionNotification {
  const agent = session.provider === 'claude' ? 'Claude Code' : 'Codex'
  const name = session.customTitle ?? session.title ?? session.project ?? agent
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
      // Seal's own panes already notify through their agent hooks.
      const inSealPane = event.session.inputRoutes.some((route) => route.kind === 'seal-pane')
      const kind = inSealPane ? null : liveSessionNotice(before, event.session)
      if (kind && this.deps.wanted()) {
        this.deps.show(describe(event.session, kind))
      }
    }
  }
}
