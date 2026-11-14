// How a recap is read out, shared by the desktop panel and the mobile sheet so both agree.
import {
  openRecapItems,
  type LiveSessionRecapBrief,
  type RecapItem,
  type RecapMarks,
  type RecapSection,
  type RecapWorkState,
  type SessionRecap,
  type SessionRecapView
} from './session-recap-types'

/** What happened while the user was away; his own questions and to-dos are flagged where they sit. */
const NEWS_SECTIONS = ['did', 'decisions', 'ignored'] as const
const COUNTED_SECTIONS = ['questions', 'actions', ...NEWS_SECTIONS] as const

export type RecapNewsItem = { section: RecapSection; item: RecapItem }

type Visit = Pick<SessionRecapView, 'recap' | 'since' | 'marks'>

/** Whether an item entered the recap after the visit before this one; never on a first visit. */
export function recapItemIsNew(view: Pick<Visit, 'since'>, item: RecapItem): boolean {
  return view.since !== null && item.at > view.since
}

/** What the agent did, decided or left aside since the visit before this one, newest first. */
export function recapNewsSinceLastLook(view: Visit): RecapNewsItem[] {
  const { recap } = view
  if (!recap) {
    return []
  }
  return NEWS_SECTIONS.flatMap((section) =>
    recap[section].filter((item) => recapItemIsNew(view, item)).map((item) => ({ section, item }))
  ).sort((a, b) => b.item.at - a.item.at)
}

/** Everything new since that visit that the user has not already ticked or dismissed. */
export function recapNewCount(view: Visit): number {
  const { recap, marks } = view
  if (!recap) {
    return 0
  }
  return COUNTED_SECTIONS.reduce(
    (count, section) =>
      count +
      recap[section].filter((item) => recapItemIsNew(view, item) && marks[item.id] === undefined)
        .length,
    0
  )
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

/** What a row's badge counts: questions and action items still on the user. */
export function recapOpenCount(brief: LiveSessionRecapBrief | undefined): number {
  return brief ? brief.questions + brief.actions : 0
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
