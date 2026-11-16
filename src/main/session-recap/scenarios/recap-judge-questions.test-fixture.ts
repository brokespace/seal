// The judge's question book: one yes/no question per criterion, each about `request` and
// `conversation` alone and each tied to the one thing the recap does when the answer is yes.
import { createHash } from 'node:crypto'
import type { RecapRequestStanding } from './recap-judge-labels.test-fixture'

export type RecapJudgeQuestion = {
  /** The standing a yes means: the labels this question is scored against. */
  truth: Exclude<RecapRequestStanding, 'working'>
  /** What the recap does on a yes. */
  action: string
  /** The share of requests standing otherwise that this may fire on: its threshold is set for it. */
  loss: number
  instructions: string
  criteria: { true: string; false: string }
}

export const RECAP_JUDGE_QUESTIONS = {
  done: {
    truth: 'done',
    action: 'show the request as addressed',
    loss: 0.02,
    instructions: 'Has the agent carried out everything `request` asks for in `conversation`?',
    criteria: {
      true: 'The agent says all of it is done or answered, or its edits, commands or subagent in `conversation` show all of it done.',
      false: 'Some of what `request` asks for is not done or answered in `conversation`.'
    }
  },
  did_part: {
    truth: 'partly',
    action: 'show the request as partly addressed, with what is left',
    loss: 0.02,
    instructions:
      'Has the agent carried out one part of `request` in `conversation` and left another part of it not carried out?',
    criteria: {
      true: '`conversation` shows a part of it done and a part of it still not done.',
      false: 'All of it is done, or none of it is.'
    }
  },
  declined: {
    truth: 'declined',
    action: 'show the request as declined, with the reason',
    loss: 0.02,
    instructions:
      'Did the agent refuse `request` or advise against it in `conversation`, and not carry it out afterwards?',
    criteria: {
      true: 'The agent gives a reason for not doing it, and `conversation` ends with it not done.',
      false: 'The agent never refused it, or carried it out after refusing.'
    }
  },
  withdrawn: {
    truth: 'withdrawn',
    action: 'take the request off the list',
    loss: 0.02,
    instructions: 'Did the user take `request` back in `conversation`?',
    criteria: {
      true: 'A later USER line says to drop it, to skip it or to do something else instead, and no USER line after that asks for it again.',
      false: 'No later USER line takes it back, or the user asked for it again afterwards.'
    }
  },
  left_undone: {
    truth: 'open',
    action: 'list the request under "Not addressed" and raise the row badge',
    // The must-keep guard: a request that stands any other way is never listed.
    loss: 0,
    instructions: 'Is `request` still waiting to be done at the end of `conversation`?',
    criteria: {
      true: 'Nothing in `conversation` carries it out, and neither the agent nor the user has called it off.',
      false:
        'It is carried out at least in part, or the agent refused it, or the user took it back.'
    }
  }
} as const satisfies Record<string, RecapJudgeQuestion>

export type RecapJudgeQuestionId = keyof typeof RECAP_JUDGE_QUESTIONS
export const RECAP_JUDGE_QUESTION_IDS = Object.keys(RECAP_JUDGE_QUESTIONS).filter(
  (id): id is RecapJudgeQuestionId => id in RECAP_JUDGE_QUESTIONS
)

/** Thresholds are only good for the wording they were set on. */
export const RECAP_JUDGE_QUESTION_BOOK = createHash('sha256')
  .update(JSON.stringify(RECAP_JUDGE_QUESTIONS))
  .digest('hex')
  .slice(0, 12)
