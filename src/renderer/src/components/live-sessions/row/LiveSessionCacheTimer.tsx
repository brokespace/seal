import React from 'react'
import {
  getStructuredAgentSessionTabsByPaneKey,
  type StructuredTab
} from '@/components/native-chat/session/status/structured-agent-session-tabs'
import CacheTimer, {
  usePromptCacheCountdownForPane
} from '@/components/sidebar/workspace-card/activity/CacheTimer'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { Tab } from '../../../../../shared/tab-types'

const paneKeysBySessionByTabs = new WeakMap<
  ReadonlyMap<string, StructuredTab>,
  ReadonlyMap<string, string>
>()

function chatPaneKey(
  sessionId: string,
  unifiedTabsByWorktree: Record<string, Tab[]>
): string | null {
  const tabsByPaneKey = getStructuredAgentSessionTabsByPaneKey(unifiedTabsByWorktree)
  let paneKeysBySession = paneKeysBySessionByTabs.get(tabsByPaneKey)
  if (!paneKeysBySession) {
    const paneKeys = new Map<string, string>()
    for (const [paneKey, tab] of tabsByPaneKey) {
      if (!paneKeys.has(tab.entityId)) {
        paneKeys.set(tab.entityId, paneKey)
      }
    }
    paneKeysBySession = paneKeys
    paneKeysBySessionByTabs.set(tabsByPaneKey, paneKeysBySession)
  }
  return paneKeysBySession.get(sessionId) ?? null
}

/**
 * The key of the session's pane in this window, null when it has none here. A chat is found by its
 * session: a paired server's tab id can differ from this window's.
 */
function windowPaneKey(
  surface: LiveSession['surface'],
  unifiedTabsByWorktree: Record<string, Tab[]>
): string | null {
  if (surface.kind === 'cli') {
    return surface.paneKey
  }
  return surface.kind === 'chat' ? chatPaneKey(surface.sessionId, unifiedTabsByWorktree) : null
}

/** How long the prompt cache of the session's pane in this window still holds. */
export function LiveSessionCacheTimer({
  session
}: {
  session: LiveSession
}): React.JSX.Element | null {
  const paneKey = useAppStore((state) =>
    windowPaneKey(session.surface, state.unifiedTabsByWorktree)
  )
  const countdown = usePromptCacheCountdownForPane(paneKey ?? '', paneKey !== null)
  if (!countdown) {
    return null
  }
  return (
    // Why: rows also sit on pages that have no tooltip provider above them.
    <TooltipProvider>
      <CacheTimer startedAt={countdown.startedAt} ttlMs={countdown.ttlMs} />
    </TooltipProvider>
  )
}
