import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionTitle } from '../live-session-presentation'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { agentSessionWorktreeId } from './agent-session-workspace'
import { openExternalAgentSessionTab } from './external-agent-session-tab'

/** Where the removed sessions page kept its open tabs. */
const LEGACY_TABS_KEY = 'seal.liveSessionTabs.v1'

function takeLegacyTabIds(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(LEGACY_TABS_KEY)
    if (raw === null || raw === undefined) {
      return []
    }
    globalThis.localStorage.removeItem(LEGACY_TABS_KEY)
    const saved: unknown = JSON.parse(raw)
    if (saved && typeof saved === 'object' && 'tabs' in saved && Array.isArray(saved.tabs)) {
      return saved.tabs.filter((id): id is string => typeof id === 'string')
    }
  } catch {
    // Unreadable: nothing to carry over.
  }
  return []
}

/**
 * Tabs the sessions page had open come back once as workspace tabs. A chat or CLI session already
 * has its tab; a session no longer listed, or with no workspace to open in, is dropped.
 */
export function migrateLegacyLiveSessionTabs(sessions: readonly LiveSession[]): void {
  for (const savedId of takeLegacyTabIds()) {
    const id = liveSessionRegistryStore.currentId(savedId)
    const session = sessions.find((candidate) => candidate.id === id)
    if (session?.surface.kind !== 'external') {
      continue
    }
    const worktreeId = agentSessionWorktreeId(session) ?? useAppStore.getState().activeWorktreeId
    if (worktreeId) {
      openExternalAgentSessionTab({
        worktreeId,
        sessionId: id,
        mode: 'tab',
        label: liveSessionTitle(session),
        agent: session.provider
      })
    }
  }
}
