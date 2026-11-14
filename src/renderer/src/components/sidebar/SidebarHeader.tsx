import React from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store/index'
import { useTranslate } from '@/i18n/use-translate'
import { SidebarHeaderActions } from './sidebar-header-actions'

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
    <div className="group/sidebar-header mt-2 flex h-8 min-w-0 shrink-0 items-center justify-between gap-1.5 px-2">
      <div
        className="flex min-w-0 items-center"
        data-contextual-tour-target={groupBy === 'repo' ? 'projects-collapse-all' : undefined}
      >
        <span
          // Truncate localized titles because fixed-width actions cannot shrink inside the short header row.
          className="min-w-0 truncate select-none pl-2 pr-0.5 text-xs font-semibold text-muted-foreground/80"
          data-sidebar-section-title={groupBy === 'repo' ? 'projects' : 'workspaces'}
        >
          {sidebarTitle}
        </span>
        {/* WorktreeList portals the collapse-all toggle here; it owns the rendered project rows. */}
        <div ref={projectsCollapseTarget} className="flex shrink-0 items-center empty:hidden" />
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SidebarHeaderActions onWorkspaceBoardMenuOpenChange={onWorkspaceBoardMenuOpenChange} />
      </div>
    </div>
  )
})

export default SidebarHeader
