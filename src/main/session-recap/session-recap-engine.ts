import {
  emptySessionRecap,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import {
  estimateRecapNeurons,
  type RecapPassKind,
  type SessionRecapBudget
} from './session-recap-budget'
import type { RecapRequestsStep } from './session-recap-judge'
import { addRecapReferences, carryRecapMarks } from './session-recap-merge'
import { recapMessageTimes, repointMovedRecap } from './session-recap-message-times'
import { readRecapChunks } from './session-recap-model-read'
import {
  RECAP_CHUNK_CHARS,
  RECAP_MAX_CHUNKS,
  readForRecap,
  recapAnchorAfter,
  type RecapReading,
  type RecapTranscript
} from './session-recap-reading'
import { recapWithHostRequests } from './session-recap-request-sources'
import type { SessionRecapStore } from './session-recap-store'
import { chunkRecapEntries, digestTranscript } from './session-recap-transcript'

/** Passes in a row whose replies could not be read before the host writes the requests down itself. */
const UNREAD_PASSES_BEFORE_HOST_REQUESTS = 2
const UNREADABLE = "The model's reply could not be read"

export type RecapPassOutcome =
  /** The recap changed. */
  | 'updated'
  /** Nothing new was said since the last pass. */
  | 'current'
  /** The transcript holds nothing to recap. */
  | 'empty'
  | 'over-budget'
  /**
   * No model's reply could be read for the second pass running. The recap holds the requests the
   * host reads itself, and the cursor stays where it was so the model reads the span once it can.
   */
  | 'degraded'
  /** Nothing was written and nothing marked as read: the provider failed, or its reply was unusable. */
  | 'failed'

export type SessionRecapEngineDeps = {
  transcript: RecapTranscript
  /** `avoid` names models whose reply to this request could not be used: another one is asked. */
  complete: (
    request: UtilityModelRequest,
    signal: AbortSignal,
    options?: { avoid?: readonly string[] }
  ) => Promise<{ text: string; model: string; provider?: string }>
  /** The provider the read step runs on now, whose daily tally it is counted against. */
  provider?: () => string | undefined
  /** The session's turn is over. Absent, only a pass made while it works reads an unfinished turn. */
  turnEnded?: (sessionId: string) => boolean
  store: SessionRecapStore
  budget: SessionRecapBudget
  /** Where each request stands, settled after the read step. Absent on a host with no judge. */
  requests?: RecapRequestsStep
  /** The session's first prompt as the registry titles it, for a recap that starts later. */
  firstPrompt: (sessionId: string) => string | null
  onChange: (sessionId: string) => void
  now?: () => number
  log?: (message: string, error?: unknown) => void
}

/**
 * Brings one session's recap up to date: the recap so far plus what the transcript gained since,
 * never the transcript from its start. One pass at a time across all sessions.
 */
export class SessionRecapEngine {
  private readonly running = new Map<string, Promise<RecapPassOutcome>>()
  private readonly failures = new Map<string, string>()
  /** Passes in a row, by session, that got replies and could read none of them. */
  private readonly unread = new Map<string, number>()
  private readonly abort = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: SessionRecapEngineDeps) {}

  isUpdating(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  /** Why the last pass for this session wrote nothing the model read; null once one does. */
  failure(sessionId: string): string | null {
    return this.failures.get(sessionId) ?? null
  }

  forget(sessionId: string): void {
    this.failures.delete(sessionId)
    this.unread.delete(sessionId)
  }

  dispose(): void {
    this.abort.abort()
  }

  /**
   * `rebuild` starts over from the recent history instead of continuing the recap. With fewer than
   * `minProseChars` of new prose the pass waits: nothing is asked of the model or marked as read.
   */
  update(
    sessionId: string,
    kind: RecapPassKind,
    rebuild = false,
    minProseChars = 0
  ): Promise<RecapPassOutcome> {
    const running = this.running.get(sessionId)
    if (running) {
      return running
    }
    const pass = this.queue
      .then(() => this.pass(sessionId, kind, rebuild, minProseChars))
      .catch((error: unknown): RecapPassOutcome => {
        if (!this.abort.signal.aborted) {
          this.failures.set(
            sessionId,
            error instanceof Error ? error.message : 'The recap could not be written'
          )
          this.deps.log?.('[session-recap] a pass failed', error)
        }
        return 'failed'
      })
      .finally(() => {
        this.running.delete(sessionId)
        this.deps.onChange(sessionId)
      })
    this.running.set(sessionId, pass)
    this.queue = pass
    this.deps.onChange(sessionId)
    return pass
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now()
  }

  private async pass(
    sessionId: string,
    kind: RecapPassKind,
    rebuild: boolean,
    minProseChars: number
  ): Promise<RecapPassOutcome> {
    const { store, budget } = this.deps
    await store.load()
    let stored = store.get(sessionId)
    const anchor = stored?.recap?.anchor
    if (!rebuild && stored?.recap && stored.times && anchor && anchor.sessionId !== sessionId) {
      // Its session carries on in another transcript: its messages have other ids and offsets there.
      const repointed = await repointMovedRecap(
        this.deps.transcript,
        sessionId,
        stored.recap,
        stored.times
      )
      if (repointed) {
        stored = store.setRecap(sessionId, repointed.recap, stored.marks, repointed.times)
      }
    }
    const reading = await readForRecap(
      this.deps.transcript,
      sessionId,
      rebuild ? null : (stored?.recap ?? null)
    )
    const digest = digestTranscript(reading.messages)
    const { base } = reading
    if (digest.entries.length === 0) {
      if (!base) {
        return 'empty'
      }
      // Tool calls alone moved the transcript: the cursor and the files touched change, and so
      // may where a request stands, since work is done with tools and a turn can end without a word.
      const read = addRecapReferences(
        {
          ...base,
          coveredTo: reading.coveredTo,
          ...recapAnchorAfter(sessionId, base.anchor, reading.messages)
        },
        digest.references,
        this.now()
      )
      const next = await this.withRequests(sessionId, kind, base, read, reading)
      const changed =
        next.references.length !== base.references.length ||
        JSON.stringify(next.requests) !== JSON.stringify(base.requests)
      const moved =
        next.coveredTo !== base.coveredTo ||
        next.anchor?.sessionId !== base.anchor?.sessionId ||
        next.anchor?.at !== base.anchor?.at
      if (changed || moved) {
        store.setRecap(
          sessionId,
          changed ? { ...next, updatedAt: this.now() } : next,
          stored?.marks ?? {},
          recapMessageTimes(stored?.times, reading.messages, next)
        )
      }
      return changed ? 'updated' : 'current'
    }
    if (digest.entries.reduce((sum, entry) => sum + entry.text.length, 0) < minProseChars) {
      return 'current'
    }
    if (!budget.allows(kind, this.deps.provider?.())) {
      return 'over-budget'
    }
    const { chunks, dropped } = chunkRecapEntries(
      digest.entries,
      RECAP_CHUNK_CHARS,
      RECAP_MAX_CHUNKS
    )
    // A rebuilt recap keeps counting ids, so none it hands out was ever another item's.
    const start: SessionRecap = base ?? {
      ...emptySessionRecap(this.now()),
      nextItemId: stored?.recap?.nextItemId ?? 1
    }
    const firstKept = dropped > 0 ? chunks[0]?.[0]?.messageId : undefined
    const firstKeptOffset = reading.messages.find(
      (message) => message.id === firstKept
    )?.transcriptOffset
    const coveredFrom = base ? base.coveredFrom : (firstKeptOffset ?? reading.coveredFrom)
    const stillWorking = this.deps.turnEnded ? !this.deps.turnEnded(sessionId) : kind === 'working'
    const written = await readRecapChunks(start, chunks, {
      firstPrompt: this.deps.firstPrompt(sessionId),
      stillWorking,
      now: () => this.now(),
      complete: (request, avoid) => this.complete(request, avoid)
    })
    if (written === null) {
      this.failures.set(sessionId, UNREADABLE)
      // A rebuild that cannot be read leaves the recap it would have replaced.
      if (rebuild) {
        return 'failed'
      }
      const unread = (this.unread.get(sessionId) ?? 0) + 1
      this.unread.set(sessionId, unread)
      if (unread < UNREAD_PASSES_BEFORE_HOST_REQUESTS) {
        return 'failed'
      }
      // The cursor and its anchor stay put: the span is the model's to read once it answers again.
      const held: SessionRecap = {
        ...addRecapReferences(
          recapWithHostRequests(start, chunks, this.now()),
          digest.references,
          this.now()
        ),
        coveredFrom,
        coveredTo: base ? base.coveredTo : reading.coveredFrom,
        updatedAt: this.now(),
        degraded: true
      }
      this.save(
        sessionId,
        stored,
        await this.withRequests(sessionId, kind, base, held, reading),
        reading
      )
      return 'degraded'
    }
    const read: SessionRecap = {
      ...addRecapReferences(written, digest.references, this.now()),
      coveredFrom,
      coveredTo: reading.coveredTo,
      updatedAt: this.now(),
      degraded: undefined,
      ...recapAnchorAfter(sessionId, base?.anchor, reading.messages)
    }
    this.save(
      sessionId,
      stored,
      await this.withRequests(sessionId, kind, stored?.recap ?? null, read, reading),
      reading
    )
    this.failures.delete(sessionId)
    this.unread.delete(sessionId)
    return 'updated'
  }

  private save(
    sessionId: string,
    stored: ReturnType<SessionRecapStore['get']>,
    recap: SessionRecap,
    reading: RecapReading
  ): void {
    this.deps.store.setRecap(
      sessionId,
      recap,
      carryRecapMarks(stored?.marks ?? {}, stored?.recap ?? null, recap),
      recapMessageTimes(stored?.times, reading.messages, recap)
    )
  }

  /** The recap with its requests settled; one made without the step keeps none. */
  private async withRequests(
    sessionId: string,
    kind: RecapPassKind,
    before: SessionRecap | null,
    recap: SessionRecap,
    reading: RecapReading
  ): Promise<SessionRecap> {
    if (!this.deps.requests) {
      return recap
    }
    const requests = await this.deps.requests({
      sessionId,
      kind,
      before: before?.requests ?? [],
      asked: recap.asked,
      messages: reading.messages,
      // How far the judge read. A recap whose cursor is held short of it shows no "Not addressed".
      coveredTo: reading.coveredTo,
      signal: this.abort.signal
    })
    return { ...recap, requests }
  }

  private async complete(
    request: UtilityModelRequest,
    avoid?: readonly string[]
  ): Promise<{ text: string; model: string }> {
    const reply = await this.deps.complete(
      request,
      this.abort.signal,
      avoid ? { avoid } : undefined
    )
    this.deps.budget.spend(
      estimateRecapNeurons(reply.model, request, reply.text),
      reply.provider ?? this.deps.provider?.()
    )
    return reply
  }
}
