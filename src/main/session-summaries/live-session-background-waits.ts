import { join } from 'node:path'
import { backgroundLeftoverLabel } from '../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { CLEF_PROVIDER_IDS } from '../utility-model/clef-decisions'
import type { UtilityModelHost } from '../utility-model/utility-model-host'
import { UtilityModelError } from '../utility-model/utility-model-provider'
import {
  BACKGROUND_WAIT_CALIBRATION,
  backgroundWaitAnswersIn,
  backgroundWaitBody,
  backgroundWaitJudgeIsCalibrated,
  backgroundWaitKey,
  backgroundWaitState,
  backgroundWaitVerdict,
  type BackgroundWaitAnswers,
  type BackgroundWaitCalibration,
  type BackgroundWaitState,
  type BackgroundWaitVerdict
} from './background-wait-judge'
import { SessionSummaryCache } from './session-summary-cache'

export type BackgroundWaitJudge = {
  calibration: BackgroundWaitCalibration
  /** Never throws: a failure is named, and the last-turn rule then stands. */
  ask(state: BackgroundWaitState): Promise<{ answers: BackgroundWaitAnswers } | { failed: string }>
}

const CACHE_SLOT = 'background-wait'
const ASK_TIMEOUT_MS = 10_000
const MAX_REMEMBERED = 400

type Asked = BackgroundWaitVerdict | 'asking' | 'failed'

function remember<Value>(map: Map<string, Value>, key: string, value: Value): void {
  map.delete(key)
  map.set(key, value)
  while (map.size > MAX_REMEMBERED) {
    map.delete(map.keys().next().value!)
  }
}

/**
 * The model's say on a Claude turn that ended with commands of its own still running: the agent
 * waits on one (`waiting-task`) or they are leftovers (`your-turn`). It is asked once per state of
 * the evidence, never on a timer; until it answers, whenever it cannot, and when its answer says
 * neither, the session keeps what the last-turn rule gave it.
 */
export class LiveSessionBackgroundWaits {
  /** By the state asked about. */
  private readonly asked = new Map<string, Asked>()
  /** By session: what stands while a changed state is being asked about. */
  private readonly last = new Map<string, BackgroundWaitVerdict>()

  constructor(
    private readonly deps: {
      judge: BackgroundWaitJudge
      onChange: () => void
      now?: () => number
    }
  ) {}

  decorate(session: LiveSession): LiveSession {
    const evidence = session.backgroundWait
    if (
      evidence === undefined ||
      !session.alive ||
      // A paired server's own judge has spoken.
      session.statusSource === 'classifier' ||
      (session.status !== 'your-turn' && session.status !== 'waiting-task')
    ) {
      this.last.delete(session.id)
      return session
    }
    if (!backgroundWaitJudgeIsCalibrated(this.deps.judge.calibration)) {
      return session
    }
    const state = backgroundWaitState(evidence, this.deps.now?.() ?? Date.now())
    const key = JSON.stringify(state)
    const asked = this.asked.get(key)
    if (asked === undefined) {
      this.ask(key, state)
    }
    if (asked === 'failed') {
      this.last.delete(session.id)
      return session
    }
    const verdict = asked === undefined || asked === 'asking' ? this.last.get(session.id) : asked
    if (verdict === undefined) {
      return session
    }
    remember(this.last, session.id, verdict)
    if (verdict === 'unsure') {
      return session
    }
    const status = verdict === 'waiting' ? 'waiting-task' : 'your-turn'
    return {
      ...session,
      status,
      statusSource: 'classifier',
      statusDetail:
        status === session.status
          ? session.statusDetail
          : status === 'your-turn'
            ? backgroundLeftoverLabel(session.activity)
            : null
    }
  }

  /** The model came back: ask again about the states it failed on. */
  retryFailed(): void {
    const failed = [...this.asked].filter(([, asked]) => asked === 'failed')
    for (const [key] of failed) {
      this.asked.delete(key)
    }
    if (failed.length > 0) {
      this.deps.onChange()
    }
  }

  private ask(key: string, state: BackgroundWaitState): void {
    remember(this.asked, key, 'asking')
    void this.deps.judge.ask(state).then((reply) => {
      const { waitingCut } = this.deps.judge.calibration
      remember(
        this.asked,
        key,
        'failed' in reply ? 'failed' : backgroundWaitVerdict(reply.answers, waitingCut)
      )
      this.deps.onChange()
    })
  }
}

function kept(text: string | null): BackgroundWaitAnswers | null {
  try {
    return text === null ? null : backgroundWaitAnswersIn(JSON.parse(text))
  } catch {
    return null
  }
}

/** Clef Flash as the judge: one call per state, answered from the cache when the state is unchanged. */
export function createClefBackgroundWaitJudge(deps: {
  /** This host's one path to Clef; throws UtilityModelError. */
  clef: UtilityModelHost['clef']
  cache: Pick<SessionSummaryCache, 'get' | 'set'>
  calibration?: BackgroundWaitCalibration
}): BackgroundWaitJudge {
  const calibration = deps.calibration ?? BACKGROUND_WAIT_CALIBRATION
  return {
    calibration,
    async ask(state) {
      const key = backgroundWaitKey(calibration.model, state)
      const cached = kept(deps.cache.get(CACHE_SLOT, key))
      if (cached) {
        return { answers: cached }
      }
      try {
        const given = await deps.clef.decide(calibration.model, {
          body: backgroundWaitBody(state),
          timeoutMs: ASK_TIMEOUT_MS
        })
        const answers = backgroundWaitAnswersIn(given.answers)
        if (!answers) {
          return { failed: 'unusable-reply' }
        }
        deps.cache.set(CACHE_SLOT, key, JSON.stringify(given.answers), Date.now())
        return { answers }
      } catch (error) {
        return { failed: error instanceof UtilityModelError ? error.kind : 'error' }
      }
    }
  }
}

/** The judge of background waits on this host's Clef, with its answer cache on disk. */
export function createLiveSessionBackgroundWaits(options: {
  models: Pick<UtilityModelHost, 'clef' | 'provider'>
  userDataPath: string
  /** A verdict arrived: the registry should publish its sessions again. */
  onChange: () => void
  log?: (message: string, error?: unknown) => void
}): { decorate: (session: LiveSession) => LiveSession; dispose: () => void } {
  const cache = new SessionSummaryCache(
    join(options.userDataPath, 'session-summaries', 'background-wait-answers.json'),
    options.log
  )
  void cache.load()
  const waits = new LiveSessionBackgroundWaits({
    judge: createClefBackgroundWaitJudge({ clef: options.models.clef, cache }),
    onChange: options.onChange
  })
  const releases = CLEF_PROVIDER_IDS.map((id) => {
    const account = options.models.provider(id)
    let paused = account.health().pausedUntil !== null
    // Every failure fires this too, so only an account that is whole again is asked once more.
    return account.subscribe(() => {
      const health = account.health()
      const wasPaused = paused
      paused = health.pausedUntil !== null
      if (!paused && (wasPaused || health.lastFailure === null)) {
        waits.retryFailed()
      }
    })
  })
  return {
    decorate: (session) => waits.decorate(session),
    dispose: () => releases.forEach((release) => release())
  }
}
