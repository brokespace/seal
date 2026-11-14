import { ChevronRight, TriangleAlert } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { cn } from '@/lib/class-names'
import { useTranslate } from '@/i18n/use-translate'
import { topLiveSessionStatus } from '../../../../../shared/live-sessions/live-session-status'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionDotState, liveSessionStatusLabel } from '../live-session-presentation'
import { LiveSessionRow, type LiveSessionRowProps } from '../row/LiveSessionRow'
import type { ActiveAgentsView } from './active-agents-model'

export type ActiveAgentsRowState = Pick<
  LiveSessionRowProps,
  'workspaceName' | 'account' | 'unread' | 'current' | 'highlighted' | 'picked' | 'tabStop'
>

export type ActiveAgentsGroupsProps = {
  view: ActiveAgentsView
  collapsedMachines: ReadonlySet<string>
  finishedOpen: boolean
  hostErrors: Readonly<Record<string, string>>
  rowState: (session: LiveSession) => ActiveAgentsRowState
  now: number
  onToggleMachine: (hostId: string) => void
  onToggleFinished: () => void
  onOpen: LiveSessionRowProps['onOpen']
  onPick: LiveSessionRowProps['onPick']
  menu?: LiveSessionRowProps['menu']
}

const HEADER =
  'flex h-6 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-[11px] leading-none text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-worktree-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-worktree-sidebar-ring'

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return (
    <ChevronRight
      className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')}
      aria-hidden="true"
    />
  )
}

function Rows({
  sessions,
  props
}: {
  sessions: readonly LiveSession[]
  props: ActiveAgentsGroupsProps
}): React.JSX.Element {
  return (
    <div className="flex flex-col pl-2">
      {sessions.map((session) => (
        <LiveSessionRow
          key={session.id}
          session={session}
          {...props.rowState(session)}
          now={props.now}
          onOpen={props.onOpen}
          onPick={props.onPick}
          menu={props.menu}
        />
      ))}
    </div>
  )
}

/** Sessions under their machines, then the ones that ended in the last day. */
export function ActiveAgentsGroups(props: ActiveAgentsGroupsProps): React.JSX.Element {
  const t = useTranslate()
  const { view, hostErrors } = props
  const listed = new Set(view.machines.map((machine) => machine.hostId))
  const orphanErrors = Object.entries(hostErrors).filter(([hostId]) => !listed.has(hostId))
  return (
    <>
      {view.machines.map((machine) => {
        const open = !props.collapsedMachines.has(machine.hostId)
        const top = topLiveSessionStatus(machine.sessions.map((session) => session.status))
        const error = hostErrors[machine.hostId]
        return (
          <div key={machine.hostId} data-active-agents-machine={machine.hostId} role="group">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => props.onToggleMachine(machine.hostId)}
              className={HEADER}
            >
              <Chevron open={open} />
              <span className="min-w-0 flex-1 truncate font-medium">{machine.label}</span>
              {error ? (
                <span title={error} className="flex shrink-0">
                  <TriangleAlert className="size-3 text-agent-question-text" />
                </span>
              ) : null}
              {/* A folded machine still says what its most urgent session needs. */}
              {!open && top ? (
                <AgentStateDot
                  state={liveSessionDotState(top)}
                  title={liveSessionStatusLabel(top)}
                />
              ) : null}
              <span className="shrink-0 tabular-nums">{machine.sessions.length}</span>
            </button>
            {open ? <Rows sessions={machine.sessions} props={props} /> : null}
          </div>
        )
      })}
      {orphanErrors.map(([hostId, error]) => (
        <p
          key={hostId}
          data-active-agents-host-error={hostId}
          className="flex items-start gap-1.5 px-1.5 py-1 text-2xs text-muted-foreground"
        >
          <TriangleAlert className="mt-px size-3 shrink-0 text-agent-question-text" />
          <span className="min-w-0 break-words">
            {t(
              'auto.components.live-sessions.sidebar.hostError',
              'Could not scan {{host}}: {{error}}',
              { host: hostId, error }
            )}
          </span>
        </p>
      ))}
      {view.finished.length > 0 ? (
        <div data-active-agents-finished role="group">
          <button
            type="button"
            aria-expanded={props.finishedOpen}
            onClick={props.onToggleFinished}
            className={HEADER}
          >
            <Chevron open={props.finishedOpen} />
            <span className="min-w-0 flex-1 truncate font-medium">
              {t('auto.components.live-sessions.sidebar.finished', 'Recently finished')}
            </span>
            <span className="shrink-0 tabular-nums">{view.finished.length}</span>
          </button>
          {props.finishedOpen ? <Rows sessions={view.finished} props={props} /> : null}
        </div>
      ) : null}
    </>
  )
}
