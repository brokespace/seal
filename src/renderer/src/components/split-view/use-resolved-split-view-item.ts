import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import {
  selectFolderWorkspaces,
  selectWorktreesByRepo
} from '@/store/workspaces/catalog/workspace-record-fields'
import { resolveSplitViewItem, type ResolvedSplitViewItem } from './split-view-item-resolution'
import type { SplitViewItem } from './split-view-types'

export function useResolvedSplitViewItem(item: SplitViewItem | null): ResolvedSplitViewItem | null {
  const catalog = useAppStore(
    useShallow((state) => ({
      worktreesByRepo: selectWorktreesByRepo(state),
      folderWorkspaces: selectFolderWorkspaces(state),
      repos: state.repos
    }))
  )
  return useMemo(() => (item ? resolveSplitViewItem(item, catalog) : null), [catalog, item])
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
  if (resolved?.kind === 'project') {
    return resolved.repo.displayName
  }
  return item?.kind === 'project'
    ? t('seal.splitView.item.project', 'Project')
    : t('seal.splitView.item.workspace', 'Workspace')
}
