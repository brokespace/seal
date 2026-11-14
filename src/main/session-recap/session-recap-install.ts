import { join } from 'node:path'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { UtilityModelService } from '../utility-model/utility-model-service'
import { LiveSessionRecaps, type LiveSessionRecapsDeps } from './live-session-recaps'
import { SessionRecapBudget } from './session-recap-budget'
import { SessionRecapEngine } from './session-recap-engine'
import { SessionRecapStore } from './session-recap-store'

export type SessionRecapInstallOptions = {
  liveSessions: LiveSessionService
  utility: UtilityModelService
  userDataPath: string
  enabled: () => boolean
  eager: boolean
  /** A recap or its ticks changed: the registry should publish its sessions again. */
  onChange: () => void
  setTimer?: LiveSessionRecapsDeps['setTimer']
  log?: (message: string, error?: unknown) => void
}

/** Session recaps over this host's registry, on the utility model the status summaries use. */
export function createLiveSessionRecaps(options: SessionRecapInstallOptions): {
  recaps: LiveSessionRecaps
  dispose: () => void
} {
  const { liveSessions, utility, log } = options
  const folder = join(options.userDataPath, 'session-recaps')
  const store = new SessionRecapStore(join(folder, 'recaps.json'), log)
  const budget = new SessionRecapBudget(join(folder, 'budget.json'), Date.now, log)
  void budget.load()
  // Rows drawn before the file was read get their titles and badges once it is.
  void store.load().then(options.onChange)
  const engine = new SessionRecapEngine({
    transcript: {
      page: (sessionId, before, limit) => liveSessions.transcriptPage(sessionId, before, limit),
      since: (sessionId, cursor) => liveSessions.transcriptSince(sessionId, cursor)
    },
    complete: (request, signal) => utility.complete(request, signal),
    store,
    budget,
    firstPrompt: (sessionId) => {
      const session = liveSessions.registry.get(sessionId)
      return session && !session.titleNamed ? session.title : null
    },
    onChange: options.onChange,
    log
  })
  const recaps = new LiveSessionRecaps({
    engine,
    store,
    enabled: options.enabled,
    pausedUntil: () => utility.health().pausedUntil,
    session: (sessionId) => liveSessions.registry.get(sessionId),
    eager: options.eager,
    setTimer: options.setTimer
  })
  const unsubscribe = liveSessions.subscribe((event) => recaps.observe(event))
  // Sessions the registry published before this subscribed are stops to consider too.
  const { revision, sessions } = liveSessions.snapshot()
  for (const session of sessions) {
    recaps.observe({ type: 'upsert', revision, session })
  }
  return {
    recaps,
    dispose: () => {
      unsubscribe()
      recaps.dispose()
      engine.dispose()
    }
  }
}
