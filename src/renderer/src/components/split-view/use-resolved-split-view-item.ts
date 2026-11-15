import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/index'
import { useLiveSessions } from '@/components/live-sessions/live-session-registry-store'
import { liveSessionTitle } from '@/components/live-sessions/live-session-presentation'
import { useTranslate } from '@/i18n/use-translate'
import { resolveSplitViewItem, type ResolvedSplitViewItem } from './split-view-item-resolution'
import type { SplitViewItem } from './split-view-types'

export function useResolvedSplitViewItem(item: SplitViewItem | null): ResolvedSplitViewItem | null {
  const { sessions } = useLiveSessions()
  const catalog = useAppStore(
    useShallow((state) => ({
      worktreesByRepo: state.worktreesByRepo,
      folderWorkspaces: state.folderWorkspaces,
      repos: state.repos
    }))
  )
  return useMemo(
    () => (item ? resolveSplitViewItem(item, catalog, sessions) : null),
    [catalog, item, sessions]
  )
}

/** What a tab, a pane's label and a placeholder call an item. */
export function useSplitViewItemTitle(
  item: SplitViewItem | null,
  resolved: ResolvedSplitViewItem | null
): string {
  const t = useTranslate()
  if (resolved?.kind === 'workspace') {
    return resolved.projectName ? `${resolved.projectName} / ${resolved.title}` : resolved.title
  }
  if (resolved?.kind === 'session') {
    return liveSessionTitle(resolved.session)
  }
  if (resolved?.kind === 'project') {
    return resolved.repo.displayName
  }
  switch (item?.kind) {
    case 'session':
      return t('auto.components.live-sessions.workspace.goneTab', 'Session ended')
    case 'project':
      return t('seal.splitView.item.project', 'Project')
    default:
      return t('seal.splitView.item.workspace', 'Workspace')
  }
}
