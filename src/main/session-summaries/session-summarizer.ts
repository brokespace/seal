import type { SessionSummaryView } from '../../shared/session-summaries/session-summary-contracts'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import type { SessionSummaryCache } from './session-summary-cache'
import {
  cleanSummary,
  prepareSummaryInput,
  summaryInputHash,
  summaryRequest,
  summaryWithoutModel
} from './session-summary-text'

export type { SessionSummaryView }

export type SessionSummarizerDeps = {
  /** The utility model's reply text; rejects when it cannot answer (unconfigured, paused, failed). */
  complete: (request: UtilityModelRequest, signal: AbortSignal) => Promise<string>
  /** Off, paused or no provider: sessions show what is cached and ask for nothing new. */
  enabled: () => boolean
  cache: SessionSummaryCache
  onChange: (sessionKey: string) => void
  setTimer?: (run: () => void, delayMs: number) => { cancel: () => void }
  now?: () => number
  debounceMs?: number
}

type Wanted = { hash: string; input: string; asking: boolean }

type Entry = {
  /** The message the session shows a summary of now; null between turns. */
  wanted: Wanted | null
  text: string | null
  /** The last request for `wanted` failed; the next trigger tries again. */
  failed: boolean
  timer: { cancel: () => void } | null
  inFlight: AbortController | null
}

/** Long enough that a status flapping between scans settles on one message. */
const DEFAULT_DEBOUNCE_MS = 1_200

function defaultTimer(run: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/**
 * One short sentence per waiting agent session. A message is summarized once per session (cache),
 * after it has stood for the debounce, with at most one request in flight per session.
 */
export class SessionSummarizer {
  private readonly entries = new Map<string, Entry>()
  private readonly setTimer: NonNullable<SessionSummarizerDeps['setTimer']>
  private readonly debounceMs: number

  constructor(private readonly deps: SessionSummarizerDeps) {
    this.setTimer = deps.setTimer ?? defaultTimer
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS
  }

  /** The session stopped on `message`: show its summary, asking the model only for one never seen. */
  request(sessionKey: string, message: string, asking: boolean): void {
    const input = prepareSummaryInput(message)
    if (!input) {
      this.clear(sessionKey)
      return
    }
    const hash = summaryInputHash(input, asking)
    const entry = this.entry(sessionKey)
    if (entry.wanted?.hash === hash && !entry.failed) {
      return
    }
    entry.timer?.cancel()
    entry.timer = null
    entry.failed = false
    const known = this.deps.cache.get(sessionKey, hash) ?? summaryWithoutModel(input)
    entry.wanted = { hash, input, asking }
    entry.text = known
    if (known === null) {
      // Unavailable counts as a failed try, so it is made up for once the model is back.
      entry.failed = !this.deps.enabled()
      if (!entry.failed) {
        this.debounce(sessionKey, entry)
      }
    }
    this.deps.onChange(sessionKey)
  }

  /** The model is available again: summarize what failed or was skipped meanwhile. */
  retryFailed(): void {
    for (const [sessionKey, entry] of this.entries) {
      if (entry.wanted && entry.failed && this.deps.enabled()) {
        entry.failed = false
        this.debounce(sessionKey, entry)
        this.deps.onChange(sessionKey)
      }
    }
  }

  /** A new turn began: the last summary no longer describes the session. */
  clear(sessionKey: string): void {
    const entry = this.entries.get(sessionKey)
    if (!entry?.wanted) {
      return
    }
    entry.timer?.cancel()
    entry.timer = null
    entry.wanted = null
    entry.text = null
    entry.failed = false
    this.deps.onChange(sessionKey)
  }

  /** The session is gone. */
  forget(sessionKey: string): void {
    const entry = this.entries.get(sessionKey)
    if (!entry) {
      return
    }
    entry.timer?.cancel()
    entry.inFlight?.abort()
    this.entries.delete(sessionKey)
  }

  view(sessionKey: string): SessionSummaryView | null {
    const entry = this.entries.get(sessionKey)
    if (!entry?.wanted) {
      return null
    }
    return { text: entry.text, pending: entry.text === null && !entry.failed }
  }

  dispose(): void {
    for (const sessionKey of this.entries.keys()) {
      this.forget(sessionKey)
    }
  }

  private entry(sessionKey: string): Entry {
    let entry = this.entries.get(sessionKey)
    if (!entry) {
      entry = { wanted: null, text: null, failed: false, timer: null, inFlight: null }
      this.entries.set(sessionKey, entry)
    }
    return entry
  }

  private debounce(sessionKey: string, entry: Entry): void {
    entry.timer?.cancel()
    entry.timer = this.setTimer(() => {
      entry.timer = null
      this.start(sessionKey, entry)
    }, this.debounceMs)
  }

  private start(sessionKey: string, entry: Entry): void {
    const wanted = entry.wanted
    // One request per session: a running one starts the next when it ends.
    if (!wanted || entry.text !== null || entry.inFlight) {
      return
    }
    // The saved cache may have finished loading since the request was made.
    const cached = this.deps.cache.get(sessionKey, wanted.hash)
    if (cached !== null) {
      entry.text = cached
      this.deps.onChange(sessionKey)
      return
    }
    const controller = new AbortController()
    entry.inFlight = controller
    void this.deps
      .complete(summaryRequest(wanted.input, wanted.asking), controller.signal)
      .then(
        (reply) => cleanSummary(reply),
        () => null
      )
      .then((text) => {
        entry.inFlight = null
        if (this.entries.get(sessionKey) !== entry) {
          return
        }
        if (text !== null) {
          this.deps.cache.set(sessionKey, wanted.hash, text, this.deps.now?.() ?? Date.now())
        }
        if (entry.wanted?.hash !== wanted.hash) {
          // The session moved on meanwhile; its own debounce may still be running.
          if (!entry.timer) {
            this.start(sessionKey, entry)
          }
          return
        }
        entry.text = text
        entry.failed = text === null
        this.deps.onChange(sessionKey)
      })
  }
}
