import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import { SessionRecapBudget } from './session-recap-budget'
import { SessionRecapEngine, type RecapTranscript } from './session-recap-engine'
import { SessionRecapStore } from './session-recap-store'

export function recapMessage(
  offset: number,
  role: 'user' | 'assistant',
  text: string
): NativeChatMessage {
  return {
    id: `o${offset}`,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: 1_000 + offset,
    source: 'transcript',
    transcriptOffset: offset
  }
}

/** A transcript that grows: byte offsets are the messages' own, its end 100 past the last. */
export function recapTranscript(messages: NativeChatMessage[]): RecapTranscript {
  const offsetOf = (message: NativeChatMessage): number => message.transcriptOffset ?? 0
  const end = (): number => (messages.length ? offsetOf(messages.at(-1)!) + 100 : 0)
  return {
    page: async (sessionId, before, limit) => {
      const earlier = messages.filter((message) => offsetOf(message) < (before ?? end()))
      const page = earlier.slice(-limit)
      const start = page.length ? offsetOf(page[0]) : 0
      return { sessionId, messages: page, cursor: before ?? end(), start, more: start > 0 }
    },
    since: async (_sessionId, cursor) => ({
      messages: messages.filter((message) => offsetOf(message) >= cursor),
      cursor: end(),
      shrank: false
    })
  }
}

/** An engine over real stores in a temp folder; `replies` are what the model answers, in order. */
export async function recapHarness(messages: NativeChatMessage[], replies: (string | Error)[]) {
  const folder = await mkdtemp(join(tmpdir(), 'seal-recap-'))
  const path = join(folder, 'recaps.json')
  const store = new SessionRecapStore(path)
  const budget = new SessionRecapBudget(join(folder, 'budget.json'), () => clock.now)
  const clock = { now: 50_000 }
  const requests: UtilityModelRequest[] = []
  const engine = new SessionRecapEngine({
    transcript: recapTranscript(messages),
    complete: async (request) => {
      requests.push(request)
      const reply = replies.shift()
      if (reply === undefined || reply instanceof Error) {
        throw reply ?? new Error('no reply queued')
      }
      return { text: reply, model: '@cf/zai-org/glm-4.7-flash' }
    },
    store,
    budget,
    firstPrompt: () => null,
    onChange: () => undefined,
    now: () => clock.now
  })
  return { engine, store, budget, requests, clock, path }
}

/** The text of the request's last message: the recap carried forward and the new messages. */
export function lastContent(request: UtilityModelRequest): string {
  return request.messages.at(-1)?.content ?? ''
}
