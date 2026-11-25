// How a recap is read out, shared by the desktop panel and the mobile sheet so both agree.
import type { LiveSession } from '../live-sessions/live-session-types'
import {
  recapNotAddressedRequests,
  recapRequestDisplay,
  recapTurnHasEnded,
  type RecapRequestDisplay,
  type RecapRequestDisplayContext
} from './session-recap-request-display'
import {
  openRecapItems,
  type LiveSessionRecapBrief,
  type RecapItem,
  type RecapItemMark,
  type RecapJudgeCriterion,
  type RecapMarks,
  type RecapRequest,
  type RecapWorkState,
  type SessionRecap,
  type SessionRecapView
} from './session-recap-types'

/** What happened while the user was away; `ignored` is the requests found not addressed. */
export type RecapNewsSection = 'did' | 'decisions' | 'ignored'

export type RecapNewsItem = { section: RecapNewsSection; item: RecapItem }

type Visit = Pick<SessionRecapView, 'recap' | 'since' | 'marks' | 'stale' | 'turnEnded'>
type Standing = Pick<Visit, 'recap' | 'marks' | 'stale' | 'turnEnded'>

/**
 * The view as the session's row has it now. A turn that started, or anything said since the recap
 * was read, takes "Not addressed" off a panel that is already open, without another read.
 */
export function recapViewOnSession(
  view: SessionRecapView,
  session: Pick<LiveSession, 'status' | 'lastActivityAt'>
): SessionRecapView {
  const stale = view.stale || (view.recap !== null && session.lastActivityAt > view.recap.updatedAt)
  // A host from before the judge sends no turn state, and nothing of its is called not addressed.
  const turnEnded = view.turnEnded === undefined ? undefined : recapTurnHasEnded(session.status)
  return stale === view.stale && turnEnded === view.turnEnded
    ? view
    : { ...view, stale, ...(turnEnded === undefined ? {} : { turnEnded }) }
}

/** The turn is over and the recap has not read it yet: nothing is claimed until it has. */
export function recapIsChecking(
  view: Pick<SessionRecapView, 'state' | 'stale' | 'turnEnded'>
): boolean {
  return (
    view.stale && view.turnEnded === true && (view.state === 'ready' || view.state === 'updating')
  )
}

function displayContext(view: Standing, recap: SessionRecap): RecapRequestDisplayContext {
  return { coveredTo: recap.coveredTo, turnEnded: view.turnEnded === true, stale: view.stale }
}

/** Requests the judge found not addressed, as items; the user's ticks and dismissals stay out. */
function notAddressedItems(view: Standing): RecapItem[] {
  const { recap } = view
  if (!recap) {
    return []
  }
  return recapNotAddressedRequests(recap, view.marks, displayContext(view, recap)).map(
    (request) => ({
      id: request.id,
      text: request.text,
      messageId: request.messageId,
      at: request.judged?.at ?? request.statusAt
    })
  )
}

function newsItems(view: Visit, recap: SessionRecap): RecapNewsItem[] {
  const of = (section: RecapNewsSection, items: readonly RecapItem[]): RecapNewsItem[] =>
    items.filter((item) => recapItemIsNew(view, item)).map((item) => ({ section, item }))
  return [
    ...of('did', recap.did),
    ...of('decisions', recap.decisions),
    ...of('ignored', notAddressedItems(view))
  ]
}

/** Whether an item entered the recap after the visit before this one; never on a first visit. */
export function recapItemIsNew(view: Pick<Visit, 'since'>, item: RecapItem): boolean {
  return view.since !== null && item.at > view.since
}

/** What the agent did, decided or left aside since the visit before this one, newest first. */
export function recapNewsSinceLastLook(view: Visit): RecapNewsItem[] {
  return view.recap ? newsItems(view, view.recap).sort((a, b) => b.item.at - a.item.at) : []
}

/** Everything new since that visit that the user has not already ticked or dismissed. */
export function recapNewCount(view: Visit): number {
  const { recap, marks } = view
  if (!recap) {
    return 0
  }
  const open = [...recap.questions, ...recap.actions].filter(
    (item) => recapItemIsNew(view, item) && marks[item.id] === undefined
  )
  return open.length + newsItems(view, recap).length
}

/** Open first, in the order they were raised, then what the user ticked or dismissed. */
export function recapItemsByMark(
  items: readonly RecapItem[],
  marks: RecapMarks
): { open: RecapItem[]; settled: RecapItem[] } {
  return {
    open: openRecapItems(items, marks),
    settled: items.filter((item) => marks[item.id] !== undefined)
  }
}

const WORK_ORDER: readonly RecapWorkState[] = ['in-progress', 'blocked', 'done']

/** The agent's work as it is read: what is going on, what is stuck, then what is finished, latest first. */
export function recapWorkByState(
  did: readonly RecapItem[]
): { state: RecapWorkState; items: RecapItem[] }[] {
  return WORK_ORDER.map((state) => ({
    state,
    items: did.filter((item) => (item.state ?? 'done') === state).sort((a, b) => b.at - a.at)
  })).filter((group) => group.items.length > 0)
}

/** Where a request's row stands: the display rule's word, or the user's own dismissal. */
export type RecapRequestRowState = RecapRequestDisplay | 'dismissed'

/** Why a row stands where it does. */
export type RecapRequestReason =
  /** The judge's answer to the one question that put it there, a probability. */
  | { by: 'judge'; criterion: RecapJudgeCriterion; score: number }
  /** The user ticked it done. */
  | { by: 'user' }
  /** Its turn is over and no judge has answered about it. */
  | { by: 'nobody' }

/** What the user can do with a request; each is a tick, a dismissal, or taking one of those back. */
export type RecapRequestAction = 'done' | 'dismiss' | 'not-done' | 'restore'

const ACTION_MARKS: Record<RecapRequestAction, RecapItemMark | null> = {
  done: 'done',
  dismiss: 'dismissed',
  'not-done': null,
  restore: null
}

/** The mark an action leaves on the request, as `sessionRecap.mark` takes it. */
export function recapRequestActionMark(action: RecapRequestAction): RecapItemMark | null {
  return ACTION_MARKS[action]
}

export type RecapRequestRow = {
  id: string
  text: string
  messageId: string | null
  /** Null from a host that keeps no status for requests: the row is the request and nothing more. */
  state: RecapRequestRowState | null
  reason: RecapRequestReason | null
  actions: readonly RecapRequestAction[]
}

export type RecapRequestList = {
  /** What is not settled: not addressed, partly done, open or in progress, then declined. */
  shown: RecapRequestRow[]
  /** Done, withdrawn or dismissed, kept behind a count. */
  folded: RecapRequestRow[]
}

const SHOWN_ORDER: readonly (readonly RecapRequestRowState[])[] = [
  ['not-addressed'],
  ['partly'],
  ['open', 'in-progress'],
  ['declined']
]
const FOLDED: readonly RecapRequestRowState[] = ['done', 'withdrawn', 'dismissed']

/** The question whose answer puts a request in each state the judge decides. */
const CRITERION: Partial<Record<RecapRequestDisplay, RecapJudgeCriterion>> = {
  'not-addressed': 'left_undone',
  partly: 'did_part',
  declined: 'declined',
  done: 'done',
  withdrawn: 'withdrawn'
}

function judgeReason(request: RecapRequest, state: RecapRequestDisplay): RecapRequestReason | null {
  const { judged } = request
  if (!judged) {
    return state === 'open' ? { by: 'nobody' } : null
  }
  const criterion = CRITERION[state]
  // A later answer that left the status standing is not the one that set it.
  if (!criterion || (state !== 'not-addressed' && judged.at !== request.statusAt)) {
    return null
  }
  return { by: 'judge', criterion, score: judged.answers[criterion] }
}

function requestRow(
  request: RecapRequest,
  mark: RecapItemMark | undefined,
  context: RecapRequestDisplayContext
): RecapRequestRow {
  const row = { id: request.id, text: request.text, messageId: request.messageId }
  // The user's own word stands over the judge's, whatever a later pass finds.
  if (mark === 'dismissed') {
    return { ...row, state: 'dismissed', reason: null, actions: ['restore'] }
  }
  if (mark === 'done') {
    return { ...row, state: 'done', reason: { by: 'user' }, actions: ['not-done'] }
  }
  const state = recapRequestDisplay(request, context)
  return {
    ...row,
    state,
    reason: judgeReason(request, state),
    actions: FOLDED.includes(state) ? [] : ['done', 'dismiss']
  }
}

/** The requests section as both clients draw it: its order, its fold and each row's actions. */
export function recapRequestList(view: Standing): RecapRequestList {
  const { recap } = view
  if (!recap) {
    return { shown: [], folded: [] }
  }
  if (!recap.requests) {
    return {
      shown: recap.asked.map(({ id, text, messageId }) => ({
        id,
        text,
        messageId,
        state: null,
        reason: null,
        actions: []
      })),
      folded: []
    }
  }
  const context = displayContext(view, recap)
  const rows = recap.requests.map((request) => requestRow(request, view.marks[request.id], context))
  const inState = (states: readonly RecapRequestRowState[]): RecapRequestRow[] =>
    rows.filter((row) => row.state !== null && states.includes(row.state))
  return { shown: SHOWN_ORDER.flatMap(inState), folded: inState(FOLDED) }
}

/** What waits on the user: questions and action items still open, and requests not addressed. */
export type RecapAttention = {
  questions: number
  actions: number
  notAddressed: number
  total: number
}

/**
 * The one count behind the row badge, the header, the bar and the phone, from the row's brief or
 * from the recap an open panel holds.
 */
export function recapAttention(
  source: LiveSessionRecapBrief | Standing | null | undefined
): RecapAttention {
  const counted = (questions: number, actions: number, notAddressed: number): RecapAttention => ({
    questions,
    actions,
    notAddressed,
    total: questions + actions + notAddressed
  })
  if (!source) {
    return counted(0, 0, 0)
  }
  if (!('recap' in source)) {
    return counted(source.questions, source.actions, source.notAddressed ?? 0)
  }
  const { recap, marks } = source
  return recap
    ? counted(
        openRecapItems(recap.questions, marks).length,
        openRecapItems(recap.actions, marks).length,
        notAddressedItems(source).length
      )
    : counted(0, 0, 0)
}

/** The one line the collapsed recap shows: where things stand, else what the session is for. */
export function recapHeadline(recap: SessionRecap | null): string | null {
  return recap?.standing ?? recap?.goal ?? null
}

/** Whether the recap holds anything worth a panel. */
export function recapHasContent(recap: SessionRecap | null): recap is SessionRecap {
  return (
    recap !== null &&
    (recap.goal !== null ||
      recap.standing !== null ||
      recap.asked.length > 0 ||
      recap.did.length > 0 ||
      recap.questions.length > 0 ||
      recap.actions.length > 0)
  )
}
