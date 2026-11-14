import React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  handleRepoHeaderCollapseAffordancePointerDown,
  stopRepoHeaderKeyboardToggle
} from './header-event-guards'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from './repo-header-action-button-class'

/** The header marks itself current while its project's overview is the page on screen. */
export const PROJECT_HEADER_OVERVIEW_CURRENT_CLASS = cn(
  'has-[[data-project-overview-current]]:rounded-md has-[[data-project-overview-current]]:bg-worktree-sidebar-accent',
  // The hover actions cover the name with the header's own background, so they follow the highlight.
  '[&:has([data-project-overview-current])_[data-repo-header-actions]]:bg-worktree-sidebar-accent'
)

/** A header's label. A project's is current while its overview is the page on screen. */
export function ProjectHeaderName({
  repo,
  label
}: {
  /** Absent on headers with no overview (groups, status sections); they only show the label. */
  repo: Repo | undefined
  label: string
}): React.JSX.Element {
  const hostId = repo ? getRepoExecutionHostId(repo) : null
  const current = useAppStore(
    (s) =>
      s.activeView === 'project' &&
      s.projectOverviewTarget?.repoId === repo?.id &&
      s.projectOverviewTarget?.hostId === hostId
  )
  return (
    <div
      data-project-overview-link={repo?.id}
      data-project-overview-current={current ? '' : undefined}
      aria-current={current ? 'page' : undefined}
      className="min-w-0 truncate text-[13px] font-semibold leading-4"
    >
      {label}
    </div>
  )
}

/** Folds a project's workspaces. Its own button because the header itself navigates. */
export function ProjectHeaderFold({
  label,
  collapsed,
  onToggle
}: {
  label: string
  collapsed: boolean
  onToggle: (event: React.MouseEvent<HTMLButtonElement>) => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      data-repo-header-collapse-affordance=""
      aria-expanded={!collapsed}
      aria-label={
        collapsed
          ? t('seal.projectOverview.sidebar.expand', 'Expand {{project}}', { project: label })
          : t('seal.projectOverview.sidebar.collapse', 'Collapse {{project}}', { project: label })
      }
      className={REPO_HEADER_ACTION_BUTTON_CLASS}
      onPointerDown={handleRepoHeaderCollapseAffordancePointerDown}
      onKeyDown={stopRepoHeaderKeyboardToggle}
      onClick={(event) => {
        event.stopPropagation()
        onToggle(event)
      }}
    >
      <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
    </Button>
  )
}

/** The hover chevron of a header that folds on click anywhere (project groups, status sections, Pinned). */
export function SectionHeaderCollapseGlyph({
  collapsed,
  onToggle
}: {
  collapsed: boolean
  onToggle: (event: React.MouseEvent<HTMLElement>) => void
}): React.JSX.Element {
  return (
    <div
      className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      data-repo-header-collapse-affordance=""
      aria-hidden
      onPointerDown={handleRepoHeaderCollapseAffordancePointerDown}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggle(event)
      }}
    >
      <ChevronDown className={cn('size-3.5 transition-transform', collapsed && '-rotate-90')} />
    </div>
  )
}
