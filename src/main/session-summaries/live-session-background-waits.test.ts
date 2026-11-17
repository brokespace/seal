import { describe, expect, it } from 'vitest'
import type { BackgroundWaitEvidence } from '../../shared/live-sessions/live-session-background-wait'
import { sampleSessionSurface } from '../../shared/live-sessions/live-session-surface.test-fixture'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import { UtilityModelError } from '../utility-model/utility-model-provider'
import {
  BACKGROUND_WAIT_QUESTION_BOOK,
  BACKGROUND_WAIT_QUESTIONS,
  backgroundWaitAnswersIn,
  backgroundWaitState,
  type BackgroundWaitAnswers,
  type BackgroundWaitCalibration
} from './background-wait-judge'
import {
  createClefBackgroundWaitJudge,
  LiveSessionBackgroundWaits
} from './live-session-background-waits'
import { SessionSummaryCache } from './session-summary-cache'

const ENDED_AT = 1_000_000
const CALIBRATED: BackgroundWaitCalibration = {
  model: 'clef-flash',
  questionBook: BACKGROUND_WAIT_QUESTION_BOOK,
  waitingCut: 0.5
}
const WAITS: BackgroundWaitAnswers = { waiting: 0.93, leftover: 0.05, other: 0.02, reason: null }
const LEFT: BackgroundWaitAnswers = { waiting: 0.04, leftover: 0.9, other: 0.06, reason: null }

function evidence(turn: 'final' | 'earlier', command = 'pnpm dev'): BackgroundWaitEvidence {
  return {
    reply: 'Started it.',
    endedAt: ENDED_AT,
    registry: 'shell',
    commands: [
      {
        kind: 'shell',
        command,
        description: null,
        turn,
        startedAt: ENDED_AT - 5_000,
        state: 'running',
        runs: ['node']
      }
    ]
  }
}

function session(overrides: Partial<LiveSession>): LiveSession {
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
    lastActivityAt: ENDED_AT,
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

function harness(
  answer: () => { answers: BackgroundWaitAnswers } | { failed: string },
  calibration = CALIBRATED
) {
  const asked: unknown[] = []
  let now = ENDED_AT + 10_000
  const waits = new LiveSessionBackgroundWaits({
    judge: {
      calibration,
      ask: async (state) => {
        asked.push(state)
        return answer()
      }
    },
    onChange: () => undefined,
    now: () => now
  })
  const shown = async (found: LiveSession): Promise<LiveSession> => {
    waits.decorate(found)
    await settle()
    return waits.decorate(found)
  }
  return { waits, asked, shown, later: (ms: number) => (now += ms) }
}

describe('LiveSessionBackgroundWaits', () => {
  it('holds the turn of an agent the model says waits, where the last-turn rule saw a leftover', async () => {
    const { shown } = harness(() => ({ answers: WAITS }))
    const left = session({ status: 'your-turn', backgroundWait: evidence('earlier') })
    expect(await shown(left)).toMatchObject({
      status: 'waiting-task',
      statusSource: 'classifier',
      statusDetail: null
    })
  })

  it('hands the turn over when the model says leftover, where the last-turn rule saw a wait', async () => {
    const { shown } = harness(() => ({ answers: LEFT }))
    const waiting = session({
      status: 'waiting-task',
      backgroundWait: evidence('final'),
      activity: {
        subagents: [],
        tasks: [
          {
            id: 'bash_1',
            label: 'pnpm dev',
            status: 'running',
            startedAt: ENDED_AT - 5_000,
            summary: null
          }
        ],
        todos: []
      }
    })
    expect(await shown(waiting)).toMatchObject({
      status: 'your-turn',
      statusSource: 'classifier',
      statusDetail: '1 background task still running'
    })
  })

  it('asks once per state of the evidence, and again only when the evidence changes', async () => {
    const { shown, asked, later } = harness(() => ({ answers: WAITS }))
    const first = session({ backgroundWait: evidence('final') })
    await shown(first)
    later(20_000)
    await shown(first)
    await shown({ ...first, lastActivityAt: ENDED_AT + 30_000 })
    expect(asked).toHaveLength(1)
    await shown(session({ backgroundWait: evidence('final', 'pnpm test') }))
    expect(asked).toHaveLength(2)
  })

  it('keeps what the last-turn rule gave when the model fails, until it is asked to try again', async () => {
    let fails = true
    const { waits, shown, asked } = harness(() =>
      fails ? { failed: 'timeout' } : { answers: LEFT }
    )
    const waiting = session({ status: 'waiting-task', backgroundWait: evidence('final') })
    expect(await shown(waiting)).toBe(waiting)
    expect(await shown(waiting)).toBe(waiting)
    expect(asked).toHaveLength(1)
    fails = false
    waits.retryFailed()
    expect((await shown(waiting)).status).toBe('your-turn')
  })

  it('never asks on wording its cut was not measured on, or about a turn that is open', async () => {
    const stale = harness(() => ({ answers: LEFT }), { ...CALIBRATED, questionBook: 'older' })
    const waiting = session({ status: 'waiting-task', backgroundWait: evidence('final') })
    expect(await stale.shown(waiting)).toBe(waiting)
    expect(stale.asked).toEqual([])
    const measured = harness(() => ({ answers: LEFT }))
    const working = session({ status: 'working', backgroundWait: evidence('final') })
    expect(await measured.shown(working)).toBe(working)
    expect(measured.asked).toEqual([])
  })

  it('reads the probability of each standing out of a choice answer', () => {
    expect(
      backgroundWaitAnswersIn({
        standing: {
          type: 'choice',
          choice: 'waiting',
          probabilities: { waiting: 0.91, leftover: 0.07, other: 0.02 },
          confidence: 0.91
        },
        reason: { type: 'choice', choice: 'command_waits', probabilities: {}, confidence: 0.6 }
      })
    ).toEqual({ waiting: 0.91, leftover: 0.07, other: 0.02, reason: 'command_waits' })
    expect(backgroundWaitAnswersIn({ standing: { choice: 'waiting' } })).toBeNull()
  })

  it('keeps a state within what the host reads, the commands that decide first', () => {
    const noise = (word: string, chars: number): string => word.repeat(chars).slice(0, chars)
    const server = { ...evidence('earlier').commands[0], command: noise('npx "serve" ', 400) }
    const state = backgroundWaitState(
      {
        ...evidence('earlier'),
        reply: `${noise('Checked the logs. ', 3000)} I will report when the run finishes.`,
        commands: [
          ...Array.from({ length: 7 }, () => server),
          { ...server, state: 'completed', turn: 'final' },
          { ...server, turn: 'final', command: `until ! pgrep -f run.py; do sleep 60; done` }
        ]
      },
      ENDED_AT + 10_000
    )
    expect(JSON.stringify(state).length).toBeLessThanOrEqual(3000)
    expect(Object.keys(state).slice(0, 2)).toEqual(['final_message', 'background_commands'])
    expect(state.final_message.endsWith('I will report when the run finishes.')).toBe(true)
    expect(state.background_commands[0]).toMatchObject({
      started: 'in this turn, seconds before this turn ended',
      command: 'until ! pgrep -f run.py; do sleep 60; done'
    })
    expect(state.background_commands.map((command) => command.now)).not.toContain('finished')
    expect(state.more_background_commands).toMatch(/^\d more, not listed$/)
  })
})

describe('createClefBackgroundWaitJudge', () => {
  const given = {
    standing: {
      type: 'choice',
      choice: 'waiting',
      probabilities: { waiting: 0.91, leftover: 0.07, other: 0.02 }
    },
    reason: { type: 'choice', choice: 'command_waits' }
  }
  const state = backgroundWaitState(evidence('final'), ENDED_AT + 10_000)

  it('asks Clef Flash about a state once, and answers from the cache after', async () => {
    const asked: unknown[] = []
    const judge = createClefBackgroundWaitJudge({
      clef: {
        decide: async (model, request) => {
          asked.push({ model, ...request })
          return { answers: given, inputTokens: 400, provider: 'openrouter' }
        }
      },
      cache: new SessionSummaryCache(null),
      calibration: CALIBRATED
    })
    const answers = { waiting: 0.91, leftover: 0.07, other: 0.02, reason: 'command_waits' }
    expect(await judge.ask(state)).toEqual({ answers })
    expect(await judge.ask(state)).toEqual({ answers })
    expect(asked).toEqual([
      {
        model: 'clef-flash',
        body: { state, questions: BACKGROUND_WAIT_QUESTIONS },
        timeoutMs: 10_000
      }
    ])
  })

  it('names a failure instead of throwing, and keeps nothing of it', async () => {
    let replies: (() => unknown)[] = [
      () => {
        throw new UtilityModelError('rate-limited', 'Paused after a rate limit')
      },
      () => ({ standing: { type: 'refusal' } }),
      () => given
    ]
    const judge = createClefBackgroundWaitJudge({
      clef: {
        decide: async () => {
          const [next, ...rest] = replies
          replies = rest
          return { answers: next(), inputTokens: null, provider: 'cloudflare-workers-ai' }
        }
      },
      cache: new SessionSummaryCache(null),
      calibration: CALIBRATED
    })
    expect(await judge.ask(state)).toEqual({ failed: 'rate-limited' })
    expect(await judge.ask(state)).toEqual({ failed: 'unusable-reply' })
    expect(await judge.ask(state)).toMatchObject({ answers: { waiting: 0.91 } })
  })
})
