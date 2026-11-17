// The judge of a Claude Code turn that ended with commands of its own still running: one decision
// model reads what the turn left behind and says whether the agent waits on it. The wording and
// the cut are measured together (docs/design/agent-status.md), so both are pinned below.
import { createHash } from 'node:crypto'
import type {
  BackgroundWaitCommand,
  BackgroundWaitEvidence
} from '../../shared/live-sessions/live-session-background-wait'
import { recapJudgeKey } from '../session-recap/session-recap-judge'
import { jsonRecord } from '../utility-model/utility-model-http-request'

export const BACKGROUND_WAIT_STANDINGS = ['waiting', 'leftover', 'other'] as const
export type BackgroundWaitStanding = (typeof BACKGROUND_WAIT_STANDINGS)[number]

/** Why, as one of a fixed list: a decision model writes no prose. */
export const BACKGROUND_WAIT_REASONS = [
  'says_waiting',
  'command_waits',
  'command_is_the_work',
  'serves_the_user',
  'work_reported_done',
  'nothing_waits_for_it',
  'cannot_tell'
] as const
export type BackgroundWaitReason = (typeof BACKGROUND_WAIT_REASONS)[number]

export const BACKGROUND_WAIT_QUESTIONS = {
  standing: {
    type: 'choice',
    instructions:
      'An AI coding agent has ended its turn and sits idle at its prompt. `final_message` is the last thing it told the user. `background_commands` lists the commands it started in the background: when each was started, what it runs, and what it is doing `now`. The agent is woken when one of them exits. Is the agent waiting for a command that is still running, or did it only leave commands running?',
    criteria: {
      waiting:
        'A command that is still running was started to wait for, or to carry out, something that comes to an end by itself: a job, a build, a test run, a deployment, a download, or a loop that sleeps and checks until something finishes. The agent goes on or reports when it exits. `final_message` saying that the work is still running, or that the agent will report when it finishes, points here; so does a still-running command that only sleeps and checks.',
      leftover:
        'The agent is not waiting for any command that is still running. What runs was left up for the user or stays up until someone stops it (a dev server, a watch mode, a log tail, a database, a tunnel, a preview), or it is left from an earlier turn while `final_message` is a finished answer about something else. A promise in `final_message` to check on something that no still-running command waits for belongs here too.',
      other:
        'Neither can be told from the state: no command is still running, or nothing is known about the one that is and `final_message` does not speak of it.'
    }
  },
  reason: {
    type: 'choice',
    instructions:
      'What in the state settles whether the agent is waiting for a command that is still running?',
    criteria: {
      says_waiting:
        '`final_message` says that the agent is waiting, that the work is still running, or that it will report or continue when the work finishes, and a still-running command is that work or waits for it.',
      command_waits:
        'A still-running command only waits: it sleeps and checks until a process, a file or a status changes, and then exits.',
      command_is_the_work:
        'A still-running command is the work itself and exits when the work is done: tests, a build, a training or evaluation run, a migration, a download.',
      serves_the_user:
        'What still runs never exits by itself: a server, a watch mode, a log tail, a database, a tunnel.',
      work_reported_done:
        '`final_message` reports the work as done or hands the next step to the user, and what still runs was started for something else.',
      nothing_waits_for_it:
        '`final_message` speaks of work that goes on or of checking back later, but no still-running command is that work or waits for it.',
      cannot_tell: 'The state does not say.'
    }
  }
} as const

/** A cut is only good for the wording it was set on. */
export const BACKGROUND_WAIT_QUESTION_BOOK = createHash('sha256')
  .update(JSON.stringify(BACKGROUND_WAIT_QUESTIONS))
  .digest('hex')
  .slice(0, 12)

export type BackgroundWaitCalibration = {
  model: string
  questionBook: string
  /** The agent waits when the model's probability of `waiting` is above this. */
  waitingCut: number
}

/**
 * The one judge of a background wait: Cloudflare Clef Flash on Cloudflare's own host, with the cut
 * measured for it on the tune split of the labelled cases. Another model's probabilities mean
 * something else at this cut.
 */
export const BACKGROUND_WAIT_CALIBRATION: BackgroundWaitCalibration = {
  model: 'clef-flash',
  questionBook: '7d0976546dbd',
  waitingCut: 0.5197
}

/** False when the wording changed since the cut was measured: the last-turn rule then stands alone. */
export function backgroundWaitJudgeIsCalibrated(
  calibration: BackgroundWaitCalibration = BACKGROUND_WAIT_CALIBRATION
): boolean {
  return calibration.questionBook === BACKGROUND_WAIT_QUESTION_BOOK
}

/**
 * Cloudflare's host may read only about the first 2,000 tokens of a state and drop the rest
 * without saying so. Shell text runs near three characters a token, so a state this long is about
 * half of that.
 */
export const BACKGROUND_WAIT_STATE_MAX_CHARS = 3000
const MESSAGE_CHARS = 760
const DESCRIPTION_CHARS = 160
const COMMAND_CHARS = 320

/** Both ends: a reply closes with what comes next, a command with what it waits for. */
function clipped(text: string, max: number): string {
  const head = Math.floor(max / 3)
  return text.length <= max ? text : `${text.slice(0, head)} … ${text.slice(head + 3 - max)}`
}

/** How long ago, in steps so coarse that the longest wait is asked about three times, not every scan. */
const AGES: readonly [number, string][] = [
  [60 * 60_000, 'less than an hour ago'],
  [24 * 60 * 60_000, 'hours ago']
]

function turnEnded(endedAt: number | null, nowMs: number): string {
  if (endedAt === null) {
    return 'not known'
  }
  return AGES.find(([under]) => nowMs - endedAt < under)?.[1] ?? 'more than a day ago'
}

/** Coarse, so a record written a moment after the turn's end does not make a new state of it. */
function span(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  if (ms < 60_000) {
    return 'seconds'
  }
  return minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`
}

function started(command: BackgroundWaitCommand, endedAt: number | null): string {
  if (command.turn === null) {
    return 'before the part of the session that was read'
  }
  const by = command.subagent ? ' by a subagent of the agent' : ''
  const turn = `${command.turn === 'final' ? 'in this turn' : 'in an earlier turn'}${by}`
  return command.startedAt === null || endedAt === null
    ? turn
    : `${turn}, ${span(endedAt - command.startedAt)} before this turn ended`
}

function doing(command: BackgroundWaitCommand): string {
  if (command.state !== 'running') {
    return command.state === 'completed' ? 'finished' : command.state
  }
  if (command.runs === null) {
    return 'still running'
  }
  if (command.origin) {
    return `still running by itself; its processes right now: ${command.runs.join(', ')}`
  }
  return command.runs.length > 0
    ? `still running; under its shell right now: ${command.runs.join(', ')}`
    : 'still running; nothing under its shell right now'
}

function tool(command: BackgroundWaitCommand): string {
  if (command.origin === 'named') {
    return 'not known: the call that started it was not read; `final_message` names it and it runs on the machine'
  }
  if (command.origin === 'detached') {
    return 'Bash; the call returned and left this job running by itself (nohup, setsid, & or a detached terminal)'
  }
  return command.kind === 'monitor' ? 'Monitor' : 'Bash, run in the background'
}

function wording(command: BackgroundWaitCommand): string {
  if (command.named) {
    return `(not known) \`final_message\` calls it ${command.named}`
  }
  return command.command ? clipped(command.command, COMMAND_CHARS) : '(not known)'
}

const REGISTRY: Partial<Record<string, string>> = {
  shell: 'idle at its prompt, with a background command of its own still running',
  idle: 'idle at its prompt, with nothing of its own running',
  busy: 'busy',
  waiting: 'held by a dialog'
}

/** What decides most comes first: a command still running, then one this turn started. */
const weight = (command: BackgroundWaitCommand): number =>
  Number(command.state === 'running') * 2 + Number(command.turn === 'final')

export type BackgroundWaitState = {
  final_message: string
  background_commands: {
    started: string
    tool: string
    description: string
    command: string
    now: string
  }[]
  /** Only when the state had no room for them all. */
  more_background_commands?: string
  agent_reports_itself: string
  turn_ended: string
}

/**
 * What the questions judge: the evidence in words, nothing that changes from scan to scan, and
 * never more than `BACKGROUND_WAIT_STATE_MAX_CHARS` of it.
 */
export function backgroundWaitState(
  evidence: BackgroundWaitEvidence,
  nowMs: number
): BackgroundWaitState {
  const commands = [...evidence.commands]
    .sort((a, b) => weight(b) - weight(a))
    .map((command) => ({
      started: started(command, evidence.endedAt),
      tool: tool(command),
      description: command.description ? clipped(command.description, DESCRIPTION_CHARS) : '(none)',
      command: wording(command),
      now: doing(command)
    }))
  const listing = (listed: number): BackgroundWaitState => ({
    final_message: evidence.reply
      ? clipped(evidence.reply, MESSAGE_CHARS)
      : '(the agent said nothing)',
    background_commands: commands.slice(0, listed),
    ...(listed < commands.length
      ? { more_background_commands: `${commands.length - listed} more, not listed` }
      : {}),
    agent_reports_itself: (evidence.registry && REGISTRY[evidence.registry]) ?? 'not known',
    turn_ended: turnEnded(evidence.endedAt, nowMs)
  })
  let listed = commands.length
  while (listed > 1 && JSON.stringify(listing(listed)).length > BACKGROUND_WAIT_STATE_MAX_CHARS) {
    listed--
  }
  return listing(listed)
}

/** What Clef is asked: the state and the whole question book. Its client adds the model and the route. */
export function backgroundWaitBody(state: BackgroundWaitState): unknown {
  return { state, questions: BACKGROUND_WAIT_QUESTIONS }
}

/** The content hash an answer is kept under: the model, the wording and the state it was asked. */
export function backgroundWaitKey(model: string, state: BackgroundWaitState): string {
  return recapJudgeKey(model, backgroundWaitBody(state))
}

/** The probability of each standing, and the reason the model picked. */
export type BackgroundWaitAnswers = Record<BackgroundWaitStanding, number> & {
  reason: BackgroundWaitReason | null
}

/** Null unless the reply holds a probability for every standing. */
export function backgroundWaitAnswersIn(answers: unknown): BackgroundWaitAnswers | null {
  const all = jsonRecord(answers)
  const given = jsonRecord(jsonRecord(all?.standing)?.probabilities)
  const chance = (standing: BackgroundWaitStanding): number | null => {
    const value = given?.[standing]
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
      ? value
      : null
  }
  const [waiting, leftover, other] = [chance('waiting'), chance('leftover'), chance('other')]
  if (waiting === null || leftover === null || other === null) {
    return null
  }
  const picked = jsonRecord(all?.reason)?.choice
  return {
    waiting,
    leftover,
    other,
    reason: BACKGROUND_WAIT_REASONS.find((reason) => reason === picked) ?? null
  }
}

/** What the model's answer settles; `unsure` leaves the session on what the last-turn rule gave it. */
export type BackgroundWaitVerdict = 'waiting' | 'leftover' | 'unsure'

/**
 * `waiting` above its cut holds the turn, and `leftover` hands it to the user only where it is
 * the likeliest standing. A `waiting` under the cut says neither: it must not take a turn away
 * from a command that still runs since the user last spoke.
 */
export function backgroundWaitVerdict(
  answers: BackgroundWaitAnswers,
  waitingCut: number
): BackgroundWaitVerdict {
  if (answers.waiting > waitingCut) {
    return 'waiting'
  }
  return answers.leftover > answers.waiting && answers.leftover >= answers.other
    ? 'leftover'
    : 'unsure'
}
