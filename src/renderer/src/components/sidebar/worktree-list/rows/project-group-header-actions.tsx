import React from 'react'
import { Ellipsis, EyeOff, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { getFolderWorkspacePathStatusDescription } from '@/lib/workspace/paths/folder-workspace-path-status'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { FolderWorkspacePathStatus } from '../../../../../../shared/folder-workspaces/folder-workspace-path-status'
import type { ExecutionHostId } from '../../../../../../shared/execution-host'
import { getFolderProjectGroupRefreshHandler } from './project-group-folder-refresh'
import { isFolderWorkspaceCreateDisabled } from './FolderPathStatusIndicator'
import { startAgentInSessionProject } from './session-project-agent-launch'
import { setProjectGroupHidden } from '../../hidden-projects/set-project-hidden'
import { isAutoProjectGroup } from '@/components/live-sessions/links/auto-project-listing'
import { MakePermanentMenuItem, makeProjectGroupPermanent } from './make-project-permanent'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from './repo-header-action-button-class'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'

type HeaderGroup = ProjectGroup | { id: null } | undefined

/** The group behind a header when a folder backs it; null for any other header. */
export function folderProjectGroupOf(group: HeaderGroup): ProjectGroup | null {
  return group && 'parentPath' in group && group.parentPath ? group : null
}

/** The group behind a header when Seal made it for sessions; null for any other header. */
export function sessionProjectGroupOf(group: HeaderGroup): ProjectGroup | null {
  return group && 'sessionProject' in group && group.sessionProject ? group : null
}

export function ProjectGroupHeaderMenu({
  groupId,
  hostId,
  label,
  projectGroup,
  sessionProjectGroup,
  onRefreshProjectGroup,
  onRename,
  onDelete
}: {
  groupId: string
  /** Owner host of the group row, so rename/delete route to the host that holds it. */
  hostId?: ExecutionHostId
  label: string
  projectGroup: ProjectGroup | null
  /** A project Seal made for sessions: it reads as a project, and can be hidden or made permanent. */
  sessionProjectGroup: ProjectGroup | null
  onRefreshProjectGroup?: (projectGroup: ProjectGroup) => void
  onRename: (groupId: string, currentName: string, hostId?: ExecutionHostId) => void
  onDelete: (groupId: string, groupName: string, hostId?: ExecutionHostId) => void
}): React.JSX.Element {
  const t = useTranslate()
  const onRefresh = getFolderProjectGroupRefreshHandler(projectGroup, onRefreshProjectGroup)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={REPO_HEADER_ACTION_BUTTON_CLASS}
          data-repo-header-action=""
          aria-label={
            sessionProjectGroup
              ? t(
                  'auto.components.sidebar.WorktreeList.609633a9e6',
                  'Project actions for {{value0}}',
                  {
                    value0: label
                  }
                )
              : t(
                  'auto.components.sidebar.WorktreeList.79465e9034',
                  'Group actions for {{value0}}',
                  {
                    value0: label
                  }
                )
          }
          onClick={(event) => event.stopPropagation()}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
        >
          <Ellipsis className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Why: Radix portals keep React bubbling through the project header; block menu events from arming row drag/collapse.
        onPointerDown={stopRepoHeaderMenuEvent}
        onMouseDown={stopRepoHeaderMenuEvent}
        onPointerUp={stopRepoHeaderMenuEvent}
        onMouseUp={stopRepoHeaderMenuEvent}
        onClick={stopRepoHeaderMenuEvent}
        onKeyDown={stopRepoHeaderMenuEvent}
      >
        {onRefresh ? (
          <DropdownMenuItem onSelect={onRefresh}>
            <RefreshCw className="size-3.5" />
            {t('auto.components.sidebar.WorktreeList.refreshProjectGroup', 'Refresh projects')}
          </DropdownMenuItem>
        ) : null}
        {sessionProjectGroup ? (
          <>
            <DropdownMenuItem onSelect={() => onRename(groupId, label, hostId)}>
              <Pencil className="size-3.5" />
              {t('seal.sessionProjects.rename', 'Rename Project')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {isAutoProjectGroup(sessionProjectGroup) ? (
              <MakePermanentMenuItem
                onSelect={() => void makeProjectGroupPermanent(sessionProjectGroup, label)}
              />
            ) : null}
            <DropdownMenuItem
              onSelect={() => void setProjectGroupHidden(sessionProjectGroup, true, label)}
            >
              <EyeOff className="size-3.5" />
              {t('sidebar.hiddenProjects.hideFromSidebar', 'Hide from Sidebar')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(groupId, label, hostId)}
            >
              <Trash2 className="size-3.5" />
              {t('auto.components.sidebar.WorktreeList.c83968f87f', 'Remove Project')}
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => onRename(groupId, label, hostId)}>
              {t('auto.components.sidebar.WorktreeList.4d7b73658c', 'Rename group')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onDelete(groupId, label, hostId)}
            >
              {t('auto.components.sidebar.WorktreeList.902115cdbe', 'Delete group')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProjectGroupCreateWorkspaceButton({
  projectGroup,
  label,
  pathStatus,
  disabled,
  onCreate
}: {
  projectGroup: ProjectGroup
  label: string
  pathStatus: FolderWorkspacePathStatus | null
  disabled: boolean
  onCreate: (projectGroup: ProjectGroup) => void
}): React.JSX.Element {
  const t = useTranslate()
  const createLabel = t(
    'auto.components.sidebar.WorktreeList.bd37a57ac8',
    'Create workspace for {{value0}}',
    { value0: label }
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          data-repo-header-action=""
          className={cn(
            REPO_HEADER_ACTION_BUTTON_CLASS,
            disabled &&
              'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent hover:text-muted-foreground/60'
          )}
          aria-label={createLabel}
          aria-disabled={disabled}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            if (disabled) {
              return
            }
            onCreate(projectGroup)
          }}
        >
          <Plus className="size-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {pathStatus?.exists === false
          ? getFolderWorkspacePathStatusDescription(pathStatus, t)
          : createLabel}
      </TooltipContent>
    </Tooltip>
  )
}

/** A project group header's +: a folder group makes a workspace; a project Seal made for sessions starts an agent. */
export function ProjectGroupHeaderAddButton({
  folderGroup,
  sessionGroup,
  label,
  pathStatus,
  onCreateFolderWorkspace
}: {
  folderGroup: ProjectGroup | null
  sessionGroup: ProjectGroup | null
  label: string
  pathStatus: FolderWorkspacePathStatus | null
  onCreateFolderWorkspace: (projectGroup: ProjectGroup) => void
}): React.JSX.Element | null {
  if (folderGroup) {
    return (
      <ProjectGroupCreateWorkspaceButton
        projectGroup={folderGroup}
        label={label}
        pathStatus={pathStatus}
        disabled={isFolderWorkspaceCreateDisabled(pathStatus)}
        onCreate={onCreateFolderWorkspace}
      />
    )
  }
  return sessionGroup ? (
    <ProjectGroupCreateWorkspaceButton
      projectGroup={sessionGroup}
      label={label}
      pathStatus={null}
      disabled={false}
      onCreate={(group) => void startAgentInSessionProject(group)}
    />
  ) : null
}
