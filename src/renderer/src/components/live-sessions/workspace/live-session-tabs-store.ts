import { useSyncExternalStore } from 'react'

/** `split` places the session in a split-view pane; the tabs themselves open as preview or kept. */
export type LiveSessionOpenMode = 'preview' | 'tab' | 'split'
export type LiveSessionPanel = 'recap' | 'subagents' | 'tasks'
export type LiveSessionFocusTarget = LiveSessionPanel | 'composer' | 'permission'

export type LiveSessionTabsState = {
  /** Open session ids, in tab-strip order. */
  tabs: string[]
  activeId: string | null
  /** The tab a plain click reuses, until it is kept. */
  previewId: string | null
  /** Something a menu asked a session's view to show; `nonce` tells repeats apart. */
  focus: { sessionId: string; target: LiveSessionFocusTarget; nonce: number } | null
  /** The project whose overview each open tab was opened from: closing the last of them leads back to it. */
  fromProject: Readonly<Record<string, string>>
}

const STORAGE_KEY = 'seal.liveSessionTabs.v1'
const EMPTY: LiveSessionTabsState = {
  tabs: [],
  activeId: null,
  previewId: null,
  focus: null,
  fromProject: {}
}

/**
 * Whether closing `sessionId` ends a visit that began on `project`'s overview: no tab is left, or
 * the closed tab filled the view alone and was the last one opened from that overview.
 */
export function closesProjectVisit(
  before: LiveSessionTabsState,
  after: LiveSessionTabsState,
  sessionId: string,
  project: string | undefined
): boolean {
  if (after.tabs.length === 0) {
    return true
  }
  return (
    project !== undefined &&
    before.activeId === sessionId &&
    before.fromProject[sessionId] === project &&
    !Object.values(after.fromProject).includes(project)
  )
}

function without(
  marks: Readonly<Record<string, string>>,
  sessionId: string | undefined
): Record<string, string> {
  return Object.fromEntries(Object.entries(marks).filter(([id]) => id !== sessionId))
}

function restore(): LiveSessionTabsState {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')
    if (saved && typeof saved === 'object' && 'tabs' in saved && Array.isArray(saved.tabs)) {
      const tabs = saved.tabs.filter((id): id is string => typeof id === 'string')
      const fields = new Map<string, unknown>(Object.entries(saved))
      const activeId = fields.get('activeId')
      return {
        ...EMPTY,
        tabs,
        activeId:
          typeof activeId === 'string' && tabs.includes(activeId) ? activeId : (tabs[0] ?? null)
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

  /** `fromProject` names the project whose overview the session is opened from, if any. */
  open(
    sessionId: string,
    mode: Exclude<LiveSessionOpenMode, 'split'> = 'preview',
    fromProject?: string
  ): void {
    const { tabs, previewId } = this.state
    const marked = (replaced?: string): Record<string, string> => ({
      ...without(this.state.fromProject, replaced),
      ...(fromProject === undefined ? {} : { [sessionId]: fromProject })
    })
    if (tabs.includes(sessionId)) {
      this.set({
        activeId: sessionId,
        previewId: mode === 'tab' && previewId === sessionId ? null : previewId,
        fromProject: marked()
      })
      return
    }
    if (mode === 'preview' && previewId && tabs.includes(previewId)) {
      // A plain click reuses the preview tab instead of piling tabs up.
      this.set({
        tabs: tabs.map((id) => (id === previewId ? sessionId : id)),
        activeId: sessionId,
        previewId: sessionId,
        fromProject: marked(previewId)
      })
      return
    }
    this.set({
      tabs: [...tabs, sessionId],
      activeId: sessionId,
      previewId: mode === 'preview' ? sessionId : previewId,
      fromProject: marked()
    })
  }

  keep(sessionId: string): void {
    if (this.state.previewId === sessionId) {
      this.set({ previewId: null })
    }
  }

  /** Opens sessions as kept tabs without showing them: a split-view chip is an open tab. */
  adopt(sessionIds: readonly string[]): void {
    const missing = sessionIds.filter((id) => !this.state.tabs.includes(id))
    const previewId = sessionIds.includes(this.state.previewId ?? '') ? null : this.state.previewId
    if (missing.length > 0 || previewId !== this.state.previewId) {
      this.set({ tabs: [...this.state.tabs, ...missing], previewId })
    }
  }

  activate(sessionId: string): void {
    if (this.state.tabs.includes(sessionId)) {
      this.set({ activeId: sessionId })
    }
  }

  close(sessionId: string): void {
    const { tabs, activeId, previewId, fromProject } = this.state
    const index = tabs.indexOf(sessionId)
    if (index === -1) {
      return
    }
    const rest = tabs.filter((id) => id !== sessionId)
    this.set({
      tabs: rest,
      // The neighbour tab takes over.
      activeId:
        activeId === sessionId ? (rest[Math.min(index, rest.length - 1)] ?? null) : activeId,
      previewId: previewId === sessionId ? null : previewId,
      fromProject: without(fromProject, sessionId)
    })
  }

  /** The same session under the id its transcript gave it keeps its tab. */
  rename(fromSessionId: string, toSessionId: string): void {
    const { tabs, activeId, previewId, focus, fromProject } = this.state
    if (!tabs.includes(fromSessionId)) {
      return
    }
    const swap = (id: string | null) => (id === fromSessionId ? toSessionId : id)
    this.set({
      tabs: [...new Set(tabs.map((id) => swap(id)!))],
      activeId: swap(activeId),
      previewId: swap(previewId),
      focus: focus?.sessionId === fromSessionId ? { ...focus, sessionId: toSessionId } : focus,
      fromProject: Object.fromEntries(
        Object.entries(fromProject).map(([id, project]) => [swap(id)!, project])
      )
    })
  }

  /** Ask a session's open view to show its recap, subagents, tasks, composer or permission card. */
  focus(sessionId: string, target: LiveSessionFocusTarget): void {
    this.set({ focus: { sessionId, target, nonce: ++this.nonce } })
  }

  private set(patch: Partial<LiveSessionTabsState>): void {
    this.state = { ...this.state, ...patch }
    try {
      const { tabs, activeId } = this.state
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }))
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
