import { useMemo } from 'react'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import { groupLiveSessionsByWorkspace } from '../../../../../shared/live-sessions/live-session-workspace-groups'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { LiveSessionRows } from './LiveSessionRows'
import { useLiveSessionPlaceOf } from './live-session-workspace-place'

const COUNT_CLASS = 'shrink-0 text-2xs font-normal text-muted-foreground tabular-nums'

/** Sessions under their project and workspace, as a page card lists them (Home, a project's overview). */
export function LiveSessionWorkspaceGroups({
  sessions,
  now,
  showProjects = true
}: {
  sessions: readonly LiveSession[]
  now: number
  /** Off where the page is already about one project. */
  showProjects?: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const machineName = useSessionMachineName()
  const placeOf = useLiveSessionPlaceOf()
  const projects = useMemo(
    () => groupLiveSessionsByWorkspace(sessions, placeOf),
    [sessions, placeOf]
  )
  return (
    <div className="divide-y divide-border">
      {projects.map((project) => (
        <div key={project.key} data-sessions-project={project.key} className="p-2">
          {showProjects ? (
            <h3 className="flex items-center gap-1.5 px-1.5 py-1 text-xs font-medium text-foreground">
              <span className="truncate">
                {project.label ??
                  t('auto.components.live-sessions.workspaceGroups.noProject', 'No project')}
              </span>
              <span className={COUNT_CLASS}>
                {project.workspaces.reduce((count, group) => count + group.sessions.length, 0)}
              </span>
            </h3>
          ) : null}
          {project.workspaces.map((workspace) => {
            const label =
              workspace.label ??
              t('auto.components.live-sessions.workspaceGroups.noFolder', 'No folder')
            return (
              <div
                key={workspace.key}
                data-sessions-workspace={workspace.key}
                data-sessions-machine={workspace.machine.hostId}
              >
                <h4
                  className={cn(
                    'flex items-center gap-1.5 px-1.5 py-1',
                    showProjects
                      ? 'text-2xs text-muted-foreground'
                      : 'text-xs font-medium text-foreground'
                  )}
                >
                  <span className="truncate" title={label}>
                    {label}
                  </span>
                  <span
                    data-live-session-machine
                    className="max-w-32 shrink-0 truncate rounded-sm border border-border px-1 text-2xs leading-[14px] font-normal text-muted-foreground"
                    title={t('auto.components.live-sessions.sessionRows.machine', 'Machine')}
                  >
                    {machineName(workspace.machine)}
                  </span>
                  {showProjects ? null : (
                    <span className={COUNT_CLASS}>{workspace.sessions.length}</span>
                  )}
                </h4>
                <LiveSessionRows
                  sessions={workspace.sessions}
                  label={label}
                  now={now}
                  layout="card"
                  // The headers above the rows already say where.
                  showPlace={false}
                />
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
