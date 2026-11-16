import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type { LiveTranscriptPage } from '../../shared/live-sessions/live-session-types'
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
import { parseRecapDelta, type RecapDeltaResult } from './session-recap-delta'
import type { RecapRequestsStep } from './session-recap-judge'
import {
  addRecapReferences,
  applyRecapDelta,
  carryRecapMarks,
  recapFallbackDelta
} from './session-recap-merge'
import { recapPrompt, recapRepairRequest } from './session-recap-prompt'
import type { SessionRecapStore } from './session-recap-store'
import { chunkRecapEntries, digestTranscript } from './session-recap-transcript'

/** About 6,900 tokens of conversation per request. */
export const RECAP_CHUNK_CHARS = 24_000
/** A first pass nobody asked for reads one chunk; one the user asked for, three. */
const AUTO_FIRST_CHUNKS = 1
const MAX_CHUNKS = 3
const BACKFILL_PAGE_MESSAGES = 200
const MAX_BACKFILL_PAGES = 8

export type RecapTranscript = {
  /** The newest `limit` messages before `before`; the file's end when null. */
  page(sessionId: string, before: number | null, limit: number): Promise<LiveTranscriptPage>
  /** Everything from `cursor` on. */
  since(
    sessionId: string,
    cursor: number
  ): Promise<{ messages: NativeChatMessage[]; cursor: number; shrank: boolean }>
}

export type RecapPassOutcome =
  /** The recap changed. */
  | 'updated'
  /** Nothing new was said since the last pass. */
  | 'current'
  /** The transcript holds nothing to recap. */
  | 'empty'
  | 'over-budget'
  | 'failed'

export type SessionRecapEngineDeps = {
  transcript: RecapTranscript
  complete: (
    request: UtilityModelRequest,
    signal: AbortSignal
  ) => Promise<{ text: string; model: string }>
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

type Reading = {
  base: SessionRecap | null
  messages: NativeChatMessage[]
  coveredFrom: number
  coveredTo: number
}

/**
 * Brings one session's recap up to date: the recap so far plus what the transcript gained since,
 * never the transcript from its start. One pass at a time across all sessions.
 */
export class SessionRecapEngine {
  private readonly running = new Map<string, Promise<RecapPassOutcome>>()
  private readonly failures = new Map<string, string>()
  private readonly abort = new AbortController()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: SessionRecapEngineDeps) {}

  isUpdating(sessionId: string): boolean {
    return this.running.has(sessionId)
  }

  /** Why the last pass for this session could not reach the provider; null once one does. */
  failure(sessionId: string): string | null {
    return this.failures.get(sessionId) ?? null
  }

  forget(sessionId: string): void {
    this.failures.delete(sessionId)
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
    const stored = store.get(sessionId)
    const reading = await this.read(sessionId, rebuild ? null : (stored?.recap ?? null))
    const digest = digestTranscript(reading.messages)
    const { base } = reading
    if (digest.entries.length === 0) {
      if (!base) {
        return 'empty'
      }
      // Tool calls alone moved the transcript: the cursor and the files touched change, and so
      // may where a request stands, since work is done with tools and a turn can end without a word.
      const read = addRecapReferences(
        { ...base, coveredTo: reading.coveredTo },
        digest.references,
        this.now()
      )
      const next = await this.withRequests(sessionId, kind, base, read, reading.messages)
      const changed =
        next.references.length !== base.references.length ||
        JSON.stringify(next.requests) !== JSON.stringify(base.requests)
      if (changed || next.coveredTo !== base.coveredTo) {
        store.setRecap(
          sessionId,
          changed ? { ...next, updatedAt: this.now() } : next,
          stored?.marks ?? {}
        )
      }
      return changed ? 'updated' : 'current'
    }
    if (digest.entries.reduce((sum, entry) => sum + entry.text.length, 0) < minProseChars) {
      return 'current'
    }
    if (!budget.allows(kind)) {
      return 'over-budget'
    }
    const maxChunks = !base && kind !== 'asked' ? AUTO_FIRST_CHUNKS : MAX_CHUNKS
    const { chunks, dropped } = chunkRecapEntries(digest.entries, RECAP_CHUNK_CHARS, maxChunks)
    // A rebuilt recap keeps counting ids, so none it hands out was ever another item's.
    let recap: SessionRecap = base ?? {
      ...emptySessionRecap(this.now()),
      nextItemId: stored?.recap?.nextItemId ?? 1
    }
    let degraded = false
    for (const chunk of chunks) {
      const prompt = recapPrompt(
        recap,
        chunk,
        this.deps.firstPrompt(sessionId),
        kind === 'working' && chunk === chunks.at(-1)
      )
      const parsed = await this.ask(prompt.request)
      degraded ||= !parsed.ok
      recap = applyRecapDelta(
        recap,
        parsed.ok ? parsed.delta : recapFallbackDelta(chunk, prompt.refOf),
        { now: this.now(), refs: prompt.refs }
      )
    }
    const firstKept = dropped > 0 ? chunks[0]?.[0]?.messageId : undefined
    const firstKeptOffset = reading.messages.find(
      (message) => message.id === firstKept
    )?.transcriptOffset
    const read: SessionRecap = {
      ...addRecapReferences(recap, digest.references, this.now()),
      coveredFrom: base ? base.coveredFrom : (firstKeptOffset ?? reading.coveredFrom),
      coveredTo: reading.coveredTo,
      updatedAt: this.now(),
      degraded: degraded ? true : undefined
    }
    const next = await this.withRequests(
      sessionId,
      kind,
      stored?.recap ?? null,
      read,
      reading.messages
    )
    store.setRecap(
      sessionId,
      next,
      carryRecapMarks(stored?.marks ?? {}, stored?.recap ?? null, next)
    )
    this.failures.delete(sessionId)
    return 'updated'
  }

  /** The recap with its requests settled; one made without the step keeps none. */
  private async withRequests(
    sessionId: string,
    kind: RecapPassKind,
    before: SessionRecap | null,
    recap: SessionRecap,
    messages: readonly NativeChatMessage[]
  ): Promise<SessionRecap> {
    if (!this.deps.requests) {
      return recap
    }
    const requests = await this.deps.requests({
      sessionId,
      kind,
      before: before?.requests ?? [],
      asked: recap.asked,
      messages,
      coveredTo: recap.coveredTo,
      signal: this.abort.signal
    })
    return { ...recap, requests }
  }

  /** What this pass has to read: the transcript since the recap, or its recent end for a first one. */
  private async read(sessionId: string, base: SessionRecap | null): Promise<Reading> {
    const { transcript } = this.deps
    if (base) {
      const read = await transcript.since(sessionId, base.coveredTo)
      if (!read.shrank) {
        return {
          base,
          messages: read.messages,
          coveredFrom: base.coveredFrom,
          coveredTo: read.cursor
        }
      }
    }
    let messages: NativeChatMessage[] = []
    let before: number | null = null
    let coveredTo = 0
    let coveredFrom = 0
    for (let pages = 0; pages < MAX_BACKFILL_PAGES; pages++) {
      const page = await transcript.page(sessionId, before, BACKFILL_PAGE_MESSAGES)
      if (before === null) {
        coveredTo = page.cursor
      }
      messages = [...page.messages, ...messages]
      coveredFrom = page.start
      const prose = digestTranscript(messages).entries.reduce(
        (sum, entry) => sum + entry.text.length,
        0
      )
      if (!page.more || page.messages.length === 0 || prose >= RECAP_CHUNK_CHARS * MAX_CHUNKS) {
        break
      }
      before = page.start
    }
    return { base: null, messages, coveredFrom, coveredTo }
  }

  /** The model's delta for one request, asked again once when its reply cannot be read. */
  private async ask(request: UtilityModelRequest): Promise<RecapDeltaResult> {
    const first = await this.complete(request)
    const parsed = parseRecapDelta(first)
    if (parsed.ok) {
      return parsed
    }
    return parseRecapDelta(await this.complete(recapRepairRequest(request, first, parsed.error)))
  }

  private async complete(request: UtilityModelRequest): Promise<string> {
    const reply = await this.deps.complete(request, this.abort.signal)
    this.deps.budget.spend(estimateRecapNeurons(reply.model, request, reply.text))
    return reply.text
  }
}
