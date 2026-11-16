import { join } from 'node:path'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { SessionTranscripts } from '../live-sessions/transcripts/session-transcript'
import { recapTurnHasEnded } from '../../shared/session-recap/session-recap-request-display'
import { SessionSummaryCache } from '../session-summaries/session-summary-cache'
import type { UtilityModelClient } from '../utility-model/utility-model-host'
import type { UtilityModelService } from '../utility-model/utility-model-service'
import { LiveSessionRecaps, type LiveSessionRecapsDeps } from './live-session-recaps'
import { ServerSessionRecaps, type ServerSessionRecapsDeps } from './server-session-recaps'
import { SessionRecapBudget } from './session-recap-budget'
import { createClefRecapJudge, RecapJudgeCallLog } from './session-recap-clef-judge'
import { redactRecapCommand } from './session-recap-command-redaction'
import { SessionRecapEngine } from './session-recap-engine'
import { createRecapRequestsStep } from './session-recap-requests'
import { SessionRecapStore } from './session-recap-store'

export type SessionRecapInstallOptions = {
  liveSessions: LiveSessionService
  transcripts: SessionTranscripts
  utility: UtilityModelClient
  /**
   * The Workers AI account, whose decision model the judge alone runs on whatever model the read
   * step uses. Absent on a host with no judge: every request then stays "Open".
   */
  decisions?: Pick<UtilityModelService, 'decide'>
  userDataPath: string
  enabled: () => boolean
  /** Reaches paired Seal servers, which keep the recaps of the sessions they run. */
  serverRecapCall?: ServerSessionRecapsDeps['call']
  /** A recap or its ticks changed: the registry should publish its sessions again. */
  onChange: () => void
  setTimer?: LiveSessionRecapsDeps['setTimer']
  log?: (message: string, error?: unknown) => void
}

/** The judge on this host's Workers AI account, with its answer cache and its call log on disk. */
function judgedRequests(
  decisions: Pick<UtilityModelService, 'decide'>,
  folder: string,
  budget: SessionRecapBudget,
  log: SessionRecapInstallOptions['log']
): ReturnType<typeof createClefRecapJudge> {
  const cache = new SessionSummaryCache(join(folder, 'judge-answers.json'), log)
  const calls = new RecapJudgeCallLog(join(folder, 'judge-calls.json'), log)
  void cache.load()
  void calls.load()
  return createClefRecapJudge({
    decide: (model, request, signal) => decisions.decide(model, request, signal),
    cache,
    spend: (neurons) => budget.spend(neurons),
    record: (call) => calls.record(call)
  })
}

/** Session recaps over this host's registry, on the utility model the status summaries use. */
export function createLiveSessionRecaps(options: SessionRecapInstallOptions): {
  recaps: LiveSessionRecaps
  dispose: () => void
} {
  const { liveSessions, transcripts, utility, log } = options
  const folder = join(options.userDataPath, 'session-recaps')
  const store = new SessionRecapStore(join(folder, 'recaps.json'), log)
  const budget = new SessionRecapBudget(join(folder, 'budget.json'), Date.now, log)
  void budget.load()
  const transcript = {
    page: (sessionId: string, before: number | null, limit: number) =>
      transcripts.of(sessionId).page(before, limit),
    since: (sessionId: string, cursor: number) => transcripts.of(sessionId).since(cursor)
  }
  const judged = options.decisions ? judgedRequests(options.decisions, folder, budget, log) : null
  // Rows drawn before the file was read get their titles and badges once it is.
  void store.load().then(options.onChange)
  const engine = new SessionRecapEngine({
    transcript,
    complete: (request, signal) => utility.complete(request, signal),
    store,
    budget,
    ...(judged
      ? {
          requests: createRecapRequestsStep({
            judge: judged,
            since: transcript.since,
            turnEnded: (sessionId) => {
              const session = liveSessions.registry.get(sessionId)
              return session !== null && recapTurnHasEnded(session.status)
            },
            allows: (kind) => budget.allows(kind),
            redact: redactRecapCommand
          })
        }
      : {}),
    firstPrompt: (sessionId) => {
      const session = liveSessions.registry.get(sessionId)
      return session && !session.titleNamed ? session.title : null
    },
    onChange: options.onChange,
    log
  })
  const serverRecaps = options.serverRecapCall
    ? new ServerSessionRecaps({ call: options.serverRecapCall })
    : null
  const recaps = new LiveSessionRecaps({
    engine,
    store,
    enabled: options.enabled,
    pausedUntil: () => utility.health().pausedUntil,
    session: (sessionId) => liveSessions.registry.get(sessionId),
    readable: (session) => transcripts.has(session),
    server: serverRecaps ?? undefined,
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
