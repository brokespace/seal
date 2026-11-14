import { useSyncExternalStore } from 'react'

export type LiveSessionOpenMode = 'preview' | 'tab' | 'split'
export type LiveSessionPanel = 'recap' | 'subagents' | 'tasks' | 'reasoning'
export type LiveSessionFocusTarget = LiveSessionPanel | 'composer' | 'permission'

export type LiveSessionTabsState = {
  /** Open session ids, in tab-strip order. */
  tabs: string[]
  activeId: string | null
  /** The session shown beside the active one. */
  splitId: string | null
  /** The tab a plain click reuses, until it is kept. */
  previewId: string | null
  /** Something a menu asked a session's view to show; `nonce` tells repeats apart. */
  focus: { sessionId: string; target: LiveSessionFocusTarget; nonce: number } | null
}

const STORAGE_KEY = 'seal.liveSessionTabs.v1'
const EMPTY: LiveSessionTabsState = {
  tabs: [],
  activeId: null,
  splitId: null,
  previewId: null,
  focus: null
}

function restore(): LiveSessionTabsState {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object' && 'tabs' in saved && Array.isArray(saved.tabs)) {
      const tabs = saved.tabs.filter((id): id is string => typeof id === 'string')
      const fields = new Map<string, unknown>(Object.entries(saved))
      const pick = (key: 'activeId' | 'splitId'): string | null => {
        const id = fields.get(key)
        return typeof id === 'string' && tabs.includes(id) ? id : null
      }
      return {
        ...EMPTY,
        tabs,
        activeId: pick('activeId') ?? tabs[0] ?? null,
        splitId: pick('splitId')
      }
    }
  } catch {
    // Unreadable or absent: start with no tabs.
  }
  return EMPTY
}

/** The agent-session tabs open in the main area. Kept across restarts; sessions are looked up live. */
export class LiveSessionTabsStore {
  private state: LiveSessionTabsState
  private readonly listeners = new Set<() => void>()
  private nonce = 0

  constructor(initial?: LiveSessionTabsState) {
    this.state = initial ?? restore()
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  readonly getState = (): LiveSessionTabsState => this.state

  open(sessionId: string, mode: LiveSessionOpenMode = 'preview'): void {
    const { tabs, previewId, activeId, splitId } = this.state
    if (mode === 'split') {
      const withTab = tabs.includes(sessionId) ? tabs : [...tabs, sessionId]
      if (activeId === null || activeId === sessionId) {
        this.set({ tabs: withTab, activeId: sessionId })
      } else {
        this.set({ tabs: withTab, splitId: sessionId })
      }
      return
    }
    if (tabs.includes(sessionId)) {
      this.set({
        activeId: splitId === sessionId ? activeId : sessionId,
        previewId: mode === 'tab' && previewId === sessionId ? null : previewId
      })
      return
    }
    if (mode === 'preview' && previewId && tabs.includes(previewId)) {
      // A plain click reuses the preview tab instead of piling tabs up.
      this.set({
        tabs: tabs.map((id) => (id === previewId ? sessionId : id)),
        activeId: sessionId,
        splitId: splitId === previewId ? null : splitId,
        previewId: sessionId
      })
      return
    }
    this.set({
      tabs: [...tabs, sessionId],
      activeId: sessionId,
      previewId: mode === 'preview' ? sessionId : previewId
    })
  }

  keep(sessionId: string): void {
    if (this.state.previewId === sessionId) {
      this.set({ previewId: null })
    }
  }

  activate(sessionId: string): void {
    if (this.state.tabs.includes(sessionId) && this.state.splitId !== sessionId) {
      this.set({ activeId: sessionId })
    }
  }

  close(sessionId: string): void {
    const { tabs, activeId, splitId, previewId } = this.state
    const index = tabs.indexOf(sessionId)
    if (index === -1) {
      return
    }
    const rest = tabs.filter((id) => id !== sessionId)
    const nextSplit = splitId === sessionId ? null : splitId
    let nextActive = activeId
    if (activeId === sessionId) {
      // The split pane's session takes over the main pane; else the neighbour tab.
      const neighbour = rest.filter((id) => id !== nextSplit)
      nextActive = neighbour[Math.min(index, neighbour.length - 1)] ?? nextSplit ?? null
    }
    this.set({
      tabs: rest,
      activeId: nextActive,
      splitId: nextSplit === nextActive ? null : nextSplit,
      previewId: previewId === sessionId ? null : previewId
    })
  }

  closeSplit(): void {
    this.set({ splitId: null })
  }

  /** The same session under the id its transcript gave it keeps its tab. */
  rename(fromSessionId: string, toSessionId: string): void {
    const { tabs, activeId, splitId, previewId, focus } = this.state
    if (!tabs.includes(fromSessionId)) {
      return
    }
    const swap = (id: string | null) => (id === fromSessionId ? toSessionId : id)
    this.set({
      tabs: [...new Set(tabs.map((id) => swap(id)!))],
      activeId: swap(activeId),
      splitId: swap(splitId) === swap(activeId) ? null : swap(splitId),
      previewId: swap(previewId),
      focus: focus?.sessionId === fromSessionId ? { ...focus, sessionId: toSessionId } : focus
    })
  }

  /** Ask a session's open view to show its recap, subagents, tasks, reasoning, composer or permission card. */
  focus(sessionId: string, target: LiveSessionFocusTarget): void {
    this.set({ focus: { sessionId, target, nonce: ++this.nonce } })
  }

  private set(patch: Partial<LiveSessionTabsState>): void {
    this.state = { ...this.state, ...patch }
    try {
      const { tabs, activeId, splitId } = this.state
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId, splitId }))
    } catch {
      // Storage full or unavailable: the tabs still work for this run.
    }
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const liveSessionTabsStore = new LiveSessionTabsStore()

export function useLiveSessionTabs(): LiveSessionTabsState {
  return useSyncExternalStore(liveSessionTabsStore.subscribe, liveSessionTabsStore.getState)
}
