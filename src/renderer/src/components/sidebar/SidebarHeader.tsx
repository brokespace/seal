import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { SidebarHeaderActions } from './sidebar-header-actions'
import { SidebarSectionHeader } from './SidebarSectionHeader'

type SidebarHeaderProps = {
  onWorkspaceBoardMenuOpenChange: (open: boolean) => void
  projectsCollapseTarget?: React.Ref<HTMLDivElement>
}

const SidebarHeader = React.memo(function SidebarHeader({
  onWorkspaceBoardMenuOpenChange,
  projectsCollapseTarget
}: SidebarHeaderProps) {
  const t = useTranslate()
  // Subscribe this memoized header to locale changes before using translate().
  useTranslation()
  const groupBy = useAppStore((s) => s.groupBy)
  const sidebarTitle =
    groupBy === 'repo'
      ? t('dashboard.sidebar.projects', 'Projects')
      : t('dashboard.sidebar.workspaces', 'Workspaces')
  return (
    <SidebarSectionHeader
      title={sidebarTitle}
      section={groupBy === 'repo' ? 'projects' : 'workspaces'}
      tourTarget={groupBy === 'repo' ? 'projects-collapse-all' : undefined}
      // WorktreeList portals the collapse-all toggle here; it owns the rendered project rows.
      toggle={
        <div ref={projectsCollapseTarget} className="flex shrink-0 items-center empty:hidden" />
      }
      actions={
        <SidebarHeaderActions onWorkspaceBoardMenuOpenChange={onWorkspaceBoardMenuOpenChange} />
      }
    />
  )
})

export default SidebarHeader
