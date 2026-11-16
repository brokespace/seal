import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import {
  emptySessionRecap,
  type SessionRecapView
} from '../../shared/session-recap/session-recap-types'
import type { UtilityModelRequest } from '../../shared/utility-model/utility-model-types'
import { SessionRecapBudget } from './session-recap-budget'
import { SessionRecapEngine, type RecapTranscript } from './session-recap-engine'
import type { RecapRequestsStep } from './session-recap-judge'
import { SessionRecapStore } from './session-recap-store'

/** A stopped Claude session on this machine, as the registry lists it. */
export function recapLiveSession(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local', connection: 'local' },
    origin: 'external',
    cwd: '/repo',
    project: 'repo',
    title: 'fix the login thing',
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath: '/t.jsonl',
    inputRoutes: [],
    permission: null,
    ...overrides
  }
}

/** The same conversation as a desktop lists it when it runs on a paired Seal server. */
export function recapServerSession(overrides: Partial<LiveSession> = {}): LiveSession {
  return recapLiveSession({
    id: 'machine-1:claude:abc',
    machine: {
      hostId: 'machine-1',
      label: 'kessel',
      kind: 'remote',
      executionHostId: 'runtime:env-kessel',
      connection: 'server'
    },
    ...overrides
  })
}

/** A current server's answer about that session: two questions, one ticked, and one request not addressed. */
export function recapServerView(overrides: Partial<SessionRecapView> = {}): SessionRecapView {
  return {
    sessionId: 'local:claude:abc',
    recap: {
      ...emptySessionRecap(2_000),
      title: 'Fix login redirect loop',
      questions: [
        { id: 'q1', text: 'Drop the audit table?', messageId: 'o10', at: 2_000 },
        { id: 'q2', text: 'Keep the old cookie name?', messageId: 'o30', at: 2_000 }
      ],
      actions: [{ id: 't3', text: 'Set the deploy secret', messageId: 'o20', at: 2_000 }],
      ignored: [{ id: 'r4', text: 'Document the flag', messageId: 'o5', at: 2_000 }],
      nextItemId: 5
    },
    marks: { q1: 'done' },
    since: null,
    state: 'ready',
    stale: false,
    pausedUntil: null,
    failure: null,
    rev: 7,
    turnEnded: true,
    ...overrides
  }
}

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
export async function recapHarness(
  messages: NativeChatMessage[],
  replies: (string | Error)[],
  requestsStep?: RecapRequestsStep
) {
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
    requests: requestsStep,
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
