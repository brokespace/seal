import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../shared/live-sessions/live-session-surface.test-fixture'
import { LiveSessionReplyAsks } from './live-session-reply-asks'
import { REPLY_ASK_TASK } from './reply-ask-task'
import { SessionSummarizer } from './session-summarizer'
import { SessionSummaryCache } from './session-summary-cache'

const UNCLEAR =
  'The deploy script can target staging or production. Should I go ahead with staging? I have not changed anything yet.'
const TELLS = 'Renamed OrderSummary to OrderReceipt in 23 files. Typecheck and tests pass.'

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: { hostId: 'local', label: 'mac', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: '/repo',
    project: 'repo',
    title: 'Deploy',
    status: 'your-turn',
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function harness(options: { reply?: string; modelSays?: string; available?: boolean } = {}) {
  const state = { reply: options.reply ?? UNCLEAR, modelSays: options.modelSays ?? 'ASKS' }
  const asked: string[] = []
  const classifier = new SessionSummarizer({
    complete: async (request) => {
      asked.push(request.messages[1].content)
      return state.modelSays
    },
    enabled: () => options.available !== false,
    cache: new SessionSummaryCache(null),
    onChange: () => {},
    task: REPLY_ASK_TASK,
    setTimer: (run) => {
      queueMicrotask(run)
      return { cancel: () => {} }
    }
  })
  const replyAsks = new LiveSessionReplyAsks({
    classifier,
    lastAssistantText: async () => state.reply
  })
  /** What the registry does with a scan: decorate, publish, and let the classifier see what was published. */
  const publish = async (scanned: LiveSession): Promise<LiveSession> => {
    replyAsks.observe({ type: 'upsert', revision: 1, session: replyAsks.decorate(scanned) })
    await settle()
    return replyAsks.decorate(scanned)
  }
  return { state, asked, publish, replyAsks }
}

describe('LiveSessionReplyAsks', () => {
  it('asks the model about a reply that may be a question, once, and shows its verdict', async () => {
    const { asked, publish } = harness()
    const shown = await publish(session())
    expect([shown.status, shown.statusSource]).toEqual(['waiting-input', 'classifier'])
    expect(asked).toEqual([`<agent_message>\n${UNCLEAR}\n</agent_message>`])

    // Later scans of the same stop, and the relabelled session itself, ask nothing more.
    expect((await publish(session())).status).toBe('waiting-input')
    expect((await publish(session({ lastActivityAt: 2_000 }))).status).toBe('waiting-input')
    expect(asked).toHaveLength(1)
  })

  it('says a finished turn is being decided until its reply is read and the model has answered', async () => {
    const { replyAsks } = harness()
    expect(replyAsks.verdict(session())).toBe('deciding')
    replyAsks.observe({ type: 'upsert', revision: 1, session: session() })
    expect(replyAsks.verdict(session())).toBe('deciding')
    await settle()
    expect(replyAsks.verdict(session())).toBe('asks')
    expect(replyAsks.verdict(session({ status: 'working' }))).toBe('tells')

    const report = harness({ modelSays: 'TELLS' })
    await report.publish(session())
    expect(report.replyAsks.verdict(session())).toBe('tells')
    const noModel = harness({ available: false })
    await noModel.publish(session())
    expect(noModel.replyAsks.verdict(session())).toBe('tells')
  })

  it('leaves "Waiting on you" when the model reads the reply as a report', async () => {
    const { publish } = harness({ modelSays: 'TELLS' })
    expect((await publish(session())).status).toBe('your-turn')
  })

  it('does not spend a request on a reply that plainly reports', async () => {
    const { asked, publish } = harness({ reply: TELLS })
    expect((await publish(session())).status).toBe('your-turn')
    expect(asked).toEqual([])
  })

  it('leaves "Waiting on you" when no model is available', async () => {
    const { asked, publish } = harness({ available: false })
    expect((await publish(session())).status).toBe('your-turn')
    expect(asked).toEqual([])
  })

  it('drops the verdict when the next turn starts and judges the next reply on its own', async () => {
    const { state, asked, publish } = harness()
    await publish(session())
    expect((await publish(session({ status: 'working', lastActivityAt: 3_000 }))).status).toBe(
      'working'
    )
    state.reply = TELLS
    expect((await publish(session({ lastActivityAt: 4_000 }))).status).toBe('your-turn')
    expect(asked).toHaveLength(1)
  })

  it('only ever relabels a finished turn', async () => {
    const { publish } = harness()
    await publish(session())
    for (const status of ['needs-permission', 'errored', 'idle', 'running-shell'] as const) {
      expect((await publish(session({ status }))).status).toBe(status)
    }
  })
})
