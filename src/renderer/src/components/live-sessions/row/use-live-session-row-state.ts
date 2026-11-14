import { useCallback } from 'react'
import { useAppStore } from '@/store/index'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { useLiveSessionLinks } from '../links/use-live-session-links'
import { isLiveSessionUnread, useLiveSessionMarks } from '../live-session-marks-store'
import { liveSessionAccountLabel, useLocalSealAccounts } from '../menu/live-session-accounts'
import { useLiveSessionTabs } from '../workspace/live-session-tabs-store'
import type { LiveSessionRowProps } from './LiveSessionRow'

export type LiveSessionRowState = Pick<
  LiveSessionRowProps,
  'workspaceName' | 'account' | 'unread' | 'current' | 'highlighted'
>

/** What a session's row says about it, the same on every surface that lists sessions. */
export function useLiveSessionRowState(): (session: LiveSession) => LiveSessionRowState {
  const { links } = useLiveSessionLinks()
  const accounts = useLocalSealAccounts()
  const marks = useLiveSessionMarks()
  const tabs = useLiveSessionTabs()
  const showingSessions = useAppStore((state) => state.activeView === 'sessions')
  const activeWorktreeId = useAppStore((state) =>
    state.activeView === 'terminal' ? state.activeWorktreeId : null
  )
  return useCallback(
    (session) => {
      const link = links.get(session.id)
      return {
        workspaceName: link?.name ?? null,
        account: liveSessionAccountLabel(session, accounts),
        unread: isLiveSessionUnread(session, marks.seenAt),
        current: showingSessions && (session.id === tabs.activeId || session.id === tabs.splitId),
        highlighted:
          marks.highlighted.has(session.id) ||
          (activeWorktreeId !== null && link?.worktreeId === activeWorktreeId)
      }
    },
    [
      links,
      accounts,
      marks.seenAt,
      marks.highlighted,
      showingSessions,
      tabs.activeId,
      tabs.splitId,
      activeWorktreeId
    ]
  )
}
