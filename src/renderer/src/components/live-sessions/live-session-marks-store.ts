import { useSyncExternalStore } from 'react'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionStatusGroup } from '../../../../../shared/live-sessions/live-session-status'
import type { ActiveAgentsChip, ActiveAgentsScope } from './active-agents-model'

export type ActiveAgentsUiState = {
  query: string
  chips: ReadonlySet<ActiveAgentsChip>
  scope: ActiveAgentsScope | null
  /** Rows picked for a bulk stop or remove; null when not picking. */
  picked: ReadonlySet<string> | null
  /** Rows a Projects badge or a fresh launch points at, until the pointer moves on. */
  highlighted: ReadonlySet<string>
  /** A row to scroll into view; `nonce` tells repeats apart. */
  reveal: { sessionId: string; nonce: number } | null
  /** Per session, the activity time the user last looked at. */
  seenAt: Readonly<Record<string, number>>
}

const SEEN_KEY = 'seal.liveSessionSeenAt.v1'
const MAX_SEEN = 500

function restoreSeen(): Record<string, number> {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(SEEN_KEY) ?? '{}')
    return saved && typeof saved === 'object'
      ? Object.fromEntries(
          Object.entries(saved).filter((entry): entry is [string, number] => {
            return typeof entry[1] === 'number'
          })
        )
      : {}
  } catch {
    return {}
  }
}

/** What the Active agents section shows and remembers: its filters, picks, highlights and read marks. */
export class ActiveAgentsUiStore {
  private state: ActiveAgentsUiState
  private readonly listeners = new Set<() => void>()
  private nonce = 0

  constructor(seenAt: Record<string, number> = restoreSeen()) {
    this.state = {
      query: '',
      chips: new Set(),
      scope: null,
      picked: null,
      highlighted: new Set(),
      reveal: null,
      seenAt
    }
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): ActiveAgentsUiState => this.state

  setQuery(query: string): void {
    this.set({ query })
  }

  toggleChip(chip: ActiveAgentsChip): void {
    const chips = new Set(this.state.chips)
    if (!chips.delete(chip)) {
      chips.add(chip)
    }
    this.set({ chips })
  }

  setScope(scope: ActiveAgentsScope | null): void {
    this.set({ scope })
  }

  clearFilters(): void {
    this.set({ query: '', chips: new Set(), scope: null })
  }

  setPicked(picked: ReadonlySet<string> | null): void {
    this.set({ picked })
  }

  togglePicked(sessionId: string): void {
    const picked = new Set(this.state.picked)
    if (!picked.delete(sessionId)) {
      picked.add(sessionId)
    }
    this.set({ picked })
  }

  highlight(sessionIds: readonly string[]): void {
    this.set({ highlighted: new Set(sessionIds) })
  }

  reveal(sessionId: string): void {
    this.set({ reveal: { sessionId, nonce: ++this.nonce }, highlighted: new Set([sessionId]) })
  }

  /** Sessions seen for the first time start out read; only what they write later is news. */
  baseline(sessions: readonly { id: string; lastActivityAt: number }[]): void {
    const fresh = sessions.filter((session) => this.state.seenAt[session.id] === undefined)
    if (fresh.length === 0) {
      return
    }
    const seenAt = { ...this.state.seenAt }
    for (const session of fresh) {
      seenAt[session.id] = session.lastActivityAt
    }
    this.set({ seenAt })
    this.saveSeen()
  }

  /** The user has seen everything the session wrote up to `activityAt`. */
  markSeen(sessionId: string, activityAt: number): void {
    if ((this.state.seenAt[sessionId] ?? 0) >= activityAt) {
      return
    }
    const entries = Object.entries({ ...this.state.seenAt, [sessionId]: activityAt })
    // Keep the newest marks only; sessions long gone need none.
    const seenAt = Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN))
    this.set({ seenAt })
    this.saveSeen()
  }

  /** The same session under a new id keeps its read mark, picks and highlight. */
  rename(fromSessionId: string, toSessionId: string): void {
    const swap = (ids: ReadonlySet<string>) =>
      new Set([...ids].map((id) => (id === fromSessionId ? toSessionId : id)))
    const { [fromSessionId]: seen, ...rest } = this.state.seenAt
    this.set({
      picked: this.state.picked ? swap(this.state.picked) : null,
      highlighted: swap(this.state.highlighted),
      seenAt: seen === undefined ? this.state.seenAt : { ...rest, [toSessionId]: seen }
    })
    this.saveSeen()
  }

  private saveSeen(): void {
    try {
      globalThis.localStorage?.setItem(SEEN_KEY, JSON.stringify(this.state.seenAt))
    } catch {
      // Storage full or unavailable: read marks last for this run.
    }
  }

  private set(patch: Partial<ActiveAgentsUiState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const activeAgentsUiStore = new ActiveAgentsUiStore()

export function useActiveAgentsUi(): ActiveAgentsUiState {
  return useSyncExternalStore(activeAgentsUiStore.subscribe, activeAgentsUiStore.getState)
}

/**
 * A session wrote something since the user last looked at it. While it is still working its
 * spinner says so; the mark is for output that now waits to be read.
 */
export function isUnread(
  session: Pick<LiveSession, 'id' | 'lastActivityAt' | 'status'>,
  seenAt: Readonly<Record<string, number>>
): boolean {
  const seen = seenAt[session.id]
  return (
    seen !== undefined &&
    session.lastActivityAt > seen &&
    liveSessionStatusGroup(session.status) !== 'working'
  )
}
