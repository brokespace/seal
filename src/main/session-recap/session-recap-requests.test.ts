import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type {
  RecapJudgeAnswers,
  RecapRequest
} from '../../shared/session-recap/session-recap-types'
import type { RecapJudge, RecapJudgeReply, RecapJudgeState } from './session-recap-judge'
import { createRecapRequestsStep } from './session-recap-requests'

const CUTS = { done: 0.5, did_part: 0.5, declined: 0.5, withdrawn: 0.5, left_undone: 0.5 }
const NONE: RecapJudgeAnswers = { done: 0, did_part: 0, declined: 0, withdrawn: 0, left_undone: 0 }

function said(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  offset: number
): NativeChatMessage {
  return {
    id,
    role,
    blocks: [{ type: 'text', text }],
    timestamp: null,
    source: 'transcript',
    transcriptOffset: offset
  }
}

const ASKED = said('m1', 'user', 'add a retry to the uploader', 10)
const ANSWERED = said('m2', 'assistant', 'I looked at the uploader.', 20)

function harness(options: {
  reply: (state: RecapJudgeState) => RecapJudgeReply
  messages?: NativeChatMessage[]
  turnEnded?: boolean
  allowed?: boolean
  cursor?: number
}) {
  const messages = options.messages ?? [ASKED, ANSWERED]
  const asked: RecapJudgeState[] = []
  const judge: RecapJudge = {
    calibration: { model: '@cf/cloudflare/clef', questionBook: 'book', cuts: CUTS },
    available: () => true,
    ask: async (state) => {
      asked.push(state)
      return options.reply(state)
    }
  }
  const step = createRecapRequestsStep({
    judge,
    since: async (_id, cursor) => ({
      messages: messages.filter((message) => (message.transcriptOffset ?? 0) >= cursor),
      cursor: options.cursor ?? 100,
      shrank: false
    }),
    turnEnded: () => options.turnEnded ?? true,
    allows: () => options.allowed ?? true,
    redact: (command) => command,
    now: () => 5000
  })
  const run = (
    before: RecapRequest[] = [],
    items = [{ id: 'a1', text: 'Add a retry to the uploader', messageId: 'm1', at: 1000 }]
  ) =>
    step({
      sessionId: 's1',
      kind: 'auto',
      before,
      asked: items,
      messages,
      coveredTo: 100,
      signal: new AbortController().signal
    })
  return { run, asked }
}

describe('recap requests step', () => {
  it('asks the judge about the request and what followed, and nothing else', async () => {
    const { run, asked } = harness({ reply: () => ({ answers: NONE, cached: false }) })
    await run()
    expect(asked).toEqual([
      {
        request: 'Add a retry to the uploader',
        conversation: 'USER: add a retry to the uploader\nAGENT: I looked at the uploader.'
      }
    ])
  })

  it('leaves a request open, with no verdict, when the judge fails', async () => {
    const { run } = harness({ reply: () => ({ failed: 'network' }) })
    expect(await run()).toEqual([
      {
        id: 'a1',
        text: 'Add a retry to the uploader',
        messageId: 'm1',
        offset: 10,
        at: 1000,
        status: 'open',
        statusAt: 1000
      }
    ])
  })

  it('keeps a request open, and marks it left undone, only on the judge saying so', async () => {
    const quiet = await harness({ reply: () => ({ answers: NONE, cached: false }) }).run()
    expect(quiet[0].status).toBe('open')
    expect(quiet[0].judged?.leftUndone).toBe(false)

    const left = await harness({
      reply: () => ({ answers: { ...NONE, left_undone: 0.9 }, cached: false })
    }).run()
    expect(left[0].status).toBe('open')
    expect(left[0].judged).toEqual({
      at: 5000,
      coveredTo: 100,
      model: '@cf/cloudflare/clef',
      questionBook: 'book',
      answers: { ...NONE, left_undone: 0.9 },
      leftUndone: true,
      turnEnded: true,
      complete: true
    })
  })

  it('settles a request the judge calls done, and never asks about it again', async () => {
    const first = harness({ reply: () => ({ answers: { ...NONE, done: 0.9 }, cached: false }) })
    const settled = await first.run()
    expect(settled[0]).toMatchObject({ status: 'addressed', statusAt: 5000 })
    expect(settled[0].judged?.leftUndone).toBe(false)

    const second = harness({
      reply: () => ({ answers: { ...NONE, left_undone: 0.9 }, cached: false })
    })
    expect((await second.run(settled))[0].status).toBe('addressed')
    expect(second.asked).toEqual([])
  })

  it('does not call a turn ended while the agent works or the user spoke last', async () => {
    const leftUndone = (): RecapJudgeReply => ({
      answers: { ...NONE, left_undone: 0.9 },
      cached: false
    })
    const working = await harness({ reply: leftUndone, turnEnded: false }).run()
    expect(working[0].judged?.turnEnded).toBe(false)

    const userLast = await harness({
      reply: leftUndone,
      messages: [ASKED, ANSWERED, said('m3', 'user', 'and what about the tests?', 30)]
    }).run()
    expect(userLast[0].judged?.turnEnded).toBe(false)
  })

  it('does not vouch for a conversation it could not read to the end', async () => {
    const leftUndone = (): RecapJudgeReply => ({
      answers: { ...NONE, left_undone: 0.9 },
      cached: false
    })
    const behind = await harness({ reply: leftUndone, cursor: 60 }).run()
    expect(behind[0].judged?.complete).toBe(false)

    const background = await harness({
      reply: leftUndone,
      messages: [
        ASKED,
        {
          ...ANSWERED,
          blocks: [
            {
              type: 'tool-call',
              name: 'Task',
              input: { prompt: 'check the uploader', run_in_background: true },
              callId: 'c1'
            }
          ]
        }
      ]
    }).run()
    expect(background[0].judged?.complete).toBe(false)
  })

  it('never calls a request from more than twenty turns ago left undone', async () => {
    const later = Array.from({ length: 21 }, (_, index) => [
      said(`u${index}`, 'user', `next thing ${index}`, 30 + index * 2),
      said(`r${index}`, 'assistant', `did thing ${index}`, 31 + index * 2)
    ]).flat()
    const old = await harness({
      reply: () => ({ answers: { ...NONE, left_undone: 0.9 }, cached: false }),
      messages: [ASKED, ANSWERED, ...later]
    }).run()
    expect(old[0].judged?.leftUndone).toBe(false)
  })

  it('asks nothing when the budget is spent or the request has no message to read from', async () => {
    const spent = harness({ reply: () => ({ answers: NONE, cached: false }), allowed: false })
    expect((await spent.run())[0].judged).toBeUndefined()
    expect(spent.asked).toEqual([])

    const unanchored = harness({ reply: () => ({ answers: NONE, cached: false }) })
    const [request] = await unanchored.run(
      [],
      [{ id: 'a1', text: 'Add a retry to the uploader', messageId: 'gone', at: 1000 }]
    )
    expect(request.status).toBe('open')
    expect(unanchored.asked).toEqual([])
  })

  it('asks about the six newest unsettled requests in one pass', async () => {
    const messages = Array.from({ length: 8 }, (_, index) =>
      said(`m${index}`, 'user', `request ${index}`, 10 + index)
    )
    const many = harness({ reply: () => ({ answers: NONE, cached: false }), messages })
    await many.run(
      [],
      messages.map((message, index) => ({
        id: `a${index}`,
        text: `request ${index}`,
        messageId: message.id,
        at: 1000
      }))
    )
    expect(many.asked.map((state) => state.request)).toEqual([
      'request 7',
      'request 6',
      'request 5',
      'request 4',
      'request 3',
      'request 2'
    ])
  })
})
