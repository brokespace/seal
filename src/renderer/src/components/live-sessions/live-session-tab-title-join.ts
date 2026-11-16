import { useAppStore } from '@/store'
import { LiveSessionAnnotateParams } from '../../../../shared/live-sessions/live-session-rpc-params'
import { liveSessionSurfaceOf } from '../../../../shared/live-sessions/live-session-surface'
import type { LiveSession } from '../../../../shared/live-sessions/live-session-types'
import { parsePaneKey } from '../../../../shared/workspace-layout/stable-pane-id'
import type { TerminalTab } from '../../../../shared/workspace-layout/terminal-tab-types'
import { liveSessionRegistryStore } from './live-session-registry-store'

type TabsByWorktree = Readonly<Record<string, readonly Pick<TerminalTab, 'id' | 'customTitle'>[]>>

export type LiveSessionTabTitleJoinDeps = {
  tabs: {
    get: () => TabsByWorktree
    /** Fires on every app-store write. */
    subscribe: (listener: () => void) => () => void
  }
  sessions: {
    get: () => readonly Pick<
      LiveSession,
      'id' | 'alive' | 'customTitle' | 'surface' | 'inputRoutes'
    >[]
  }
  /** Saves the session's custom title in Seal; null goes back to the agent's own title. */
  annotate: (sessionId: string, customTitle: string | null) => void
}

function givenName(title: string | null | undefined): string | null {
  return title?.trim() || null
}

/**
 * A terminal tab the user renames gives its name to the row of the CLI session running in it; the
 * main process names the tab after a renamed row. Returns the stop function.
 */
export function joinLiveSessionTitlesWithTabTitles({
  tabs,
  sessions,
  annotate
}: LiveSessionTabTitleJoinDeps): () => void {
  let lastTabs: TabsByWorktree | undefined = undefined
  let titles = new Map<string, string | null>()

  const nameRowOf = (tabId: string, title: string | null): void => {
    // A row's name is capped where a tab's is not; a longer tab name stays the tab's alone.
    if (!LiveSessionAnnotateParams.shape.customTitle.safeParse(title).success) {
      return
    }
    const inTab = sessions.get().filter((session) => {
      const surface = liveSessionSurfaceOf(session)
      return (
        session.alive && surface.kind === 'cli' && parsePaneKey(surface.paneKey)?.tabId === tabId
      )
    })
    // A tab split between several agents names none of them.
    if (inTab.length === 1 && givenName(inTab[0].customTitle) !== title) {
      annotate(inTab[0].id, title)
    }
  }

  const onTabsChanged = (): void => {
    const listed = tabs.get()
    if (listed === lastTabs) {
      return
    }
    lastTabs = listed
    const before = titles
    titles = new Map()
    const renamed: [tabId: string, title: string | null][] = []
    for (const bucket of Object.values(listed)) {
      for (const tab of bucket) {
        // A tab several worktrees own is listed under each.
        if (titles.has(tab.id)) {
          continue
        }
        const title = givenName(tab.customTitle)
        titles.set(tab.id, title)
        // A tab named before it was first seen is not being renamed.
        if (before.has(tab.id) && before.get(tab.id) !== title) {
          renamed.push([tab.id, title])
        }
      }
    }
    for (const [tabId, title] of renamed) {
      nameRowOf(tabId, title)
    }
  }

  const stop = tabs.subscribe(onTabsChanged)
  onTabsChanged()
  return stop
}

/** The join over the app's own stores: the app store's terminal tabs and the session registry. */
export function startLiveSessionTabTitleJoin(): () => void {
  return joinLiveSessionTitlesWithTabTitles({
    tabs: {
      get: () => useAppStore.getState().tabsByWorktree,
      subscribe: useAppStore.subscribe
    },
    sessions: { get: () => liveSessionRegistryStore.getState().sessions },
    annotate: (sessionId, customTitle) =>
      void window.api.liveSessions
        .annotate({ sessionId, customTitle })
        .catch((error: unknown) =>
          console.warn('[live-sessions] a renamed tab did not rename its session', error)
        )
  })
}
