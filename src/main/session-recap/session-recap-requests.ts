// The requests step of a pass: one request per `asked` item, and the judge's word on where each
// unsettled one stands. Code decides everything here except the five answers the judge gives.
import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import type {
  RecapRequest,
  RecapRequestStatus
} from '../../shared/session-recap/session-recap-types'
import type { RecapPassKind } from './session-recap-budget'
import { fitRecapConversation, recapConversationSince } from './session-recap-conversation'
import {
  recapJudgeVerdict,
  type RecapJudge,
  type RecapJudgeVerdict,
  type RecapRequestsPass,
  type RecapRequestsStep
} from './session-recap-judge'
import { sameRecapText } from './session-recap-merge'

/** Most requests asked about in one pass, newest first: a long list of old ones cannot crowd a pass. */
export const RECAP_MAX_JUDGED_PER_PASS = 6
/** A request this many user turns old is still closed by the judge, but never called not addressed. */
export const RECAP_NOT_ADDRESSED_MAX_TURNS = 20

export type RecapRequestsDeps = {
  judge: RecapJudge
  /** The session's transcript from `cursor` on. */
  since: (
    sessionId: string,
    cursor: number
  ) => Promise<{ messages: NativeChatMessage[]; cursor: number; shrank: boolean }>
  /** The session's turn is over: nothing running, nothing parked. */
  turnEnded: (sessionId: string) => boolean
  /** Today's allowance still covers a pass of this kind. */
  allows: (kind: RecapPassKind) => boolean
  /** Takes the credentials out of a command line before it leaves this host. */
  redact: (command: string) => string
  now?: () => number
}

/** What each verdict settles. `left-undone` and `open` leave the status to stand as it was. */
const SETTLES: Partial<Record<RecapJudgeVerdict, RecapRequestStatus>> = {
  addressed: 'addressed',
  partly: 'partly',
  declined: 'declined',
  withdrawn: 'withdrawn'
}

/** Failures of the account and not of one question: asking about the next request would fail too. */
const ACCOUNT_FAILURES: ReadonlySet<string> = new Set([
  'not-configured',
  'unauthorized',
  'rate-limited',
  'plan-unavailable',
  'model-not-found'
])

/** Done and taken back are final here: only a new request from the user starts them again. */
const isFinal = (request: RecapRequest): boolean =>
  request.status === 'addressed' || request.status === 'withdrawn'

function carried(pass: RecapRequestsPass): RecapRequest[] {
  return pass.asked.map((item) => {
    // A rebuilt recap hands out new ids: a request is then known again by its words.
    const before =
      pass.before.find((request) => request.id === item.id) ??
      pass.before.find((request) => sameRecapText(request.text, item.text))
    const offset =
      pass.messages.find((message) => message.id === item.messageId)?.transcriptOffset ??
      (before?.messageId === item.messageId ? before.offset : undefined)
    return {
      id: item.id,
      text: item.text,
      messageId: item.messageId,
      ...(offset === undefined ? {} : { offset }),
      at: before?.at ?? item.at,
      status: before?.status ?? 'open',
      statusAt: before?.statusAt ?? item.at,
      ...(before?.judged ? { judged: before.judged } : {})
    }
  })
}

export function createRecapRequestsStep(deps: RecapRequestsDeps): RecapRequestsStep {
  const now = (): number => deps.now?.() ?? Date.now()
  const { judge } = deps
  return async (pass) => {
    const requests = carried(pass)
    if (!judge.available() || !deps.allows(pass.kind)) {
      return requests
    }
    const turnEnded = deps.turnEnded(pass.sessionId)
    const reads = new Map<number, ReturnType<RecapRequestsDeps['since']>>()
    const due = requests
      .filter((request) => !isFinal(request) && request.offset !== undefined)
      .slice(-RECAP_MAX_JUDGED_PER_PASS)
      .toReversed()
    for (const request of due) {
      const { messageId, offset } = request
      if (pass.signal.aborted || messageId === null || offset === undefined) {
        continue
      }
      // A file is read from an offset on, a journal from after a sequence: one back covers both.
      const from = Math.max(0, offset - 1)
      const read = await (reads.get(from) ??
        reads.set(from, deps.since(pass.sessionId, from)).get(from))
      const conversation = read && recapConversationSince(read.messages, messageId, deps.redact)
      if (!read || !conversation) {
        continue
      }
      const fitted = fitRecapConversation(conversation.lines)
      const reply = await judge.ask(
        { request: request.text, conversation: fitted.text },
        pass.signal
      )
      if ('failed' in reply) {
        // The safe default: it stands as it stood, and an old verdict no longer matches the cursor.
        if (ACCOUNT_FAILURES.has(reply.failed)) {
          break
        }
        continue
      }
      const verdict = recapJudgeVerdict(reply.answers, judge.calibration.cuts)
      const status = SETTLES[verdict] ?? request.status
      const at = now()
      const index = requests.indexOf(request)
      requests[index] = {
        ...request,
        status,
        statusAt: status === request.status ? request.statusAt : at,
        judged: {
          at,
          coveredTo: pass.coveredTo,
          model: judge.calibration.model,
          questionBook: judge.calibration.questionBook,
          answers: reply.answers,
          leftUndone:
            verdict === 'left-undone' && conversation.userTurns <= RECAP_NOT_ADDRESSED_MAX_TURNS,
          // A message the user sent after the agent last spoke belongs to a turn still to come.
          turnEnded: turnEnded && !conversation.endsOnUser,
          complete:
            conversation.complete &&
            fitted.dropped === 0 &&
            !read.shrank &&
            read.cursor >= pass.coveredTo
        }
      }
    }
    return requests
  }
}
