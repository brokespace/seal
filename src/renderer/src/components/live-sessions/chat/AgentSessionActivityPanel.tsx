import { Check, ChevronRight, Circle, CircleDot, FileText } from 'lucide-react'
import { AgentStateDot, type AgentDotState } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/class-names'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { formatShortTimeAgo } from '@/lib/time-format/short-time-ago'
import {
  runningSubagents,
  type LiveBackgroundTask,
  type LiveSessionActivity,
  type LiveSubagent,
  type LiveSubagentStatus,
  type LiveTodo
} from '../../../../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionLeftoverLabel } from '../live-session-presentation'
import type { AgentSessionPanel } from './agent-session-focus-requests'
import {
  AgentSessionPanelEmpty as Empty,
  AgentSessionPanelSectionTitle as SectionTitle,
  AgentSessionSidePanel
} from './AgentSessionSidePanel'

/** The panels that read the session's own activity; its recap has a panel of its own. */
type AgentSessionActivityPanelKind = Exclude<AgentSessionPanel, 'recap'>

function runDotState(status: LiveSubagentStatus): AgentDotState {
  switch (status) {
    case 'running':
      return 'working'
    case 'completed':
      return 'done'
    case 'failed':
      return 'failed'
    case 'stopped':
      return 'interrupted'
  }
}

function liveRunStatusLabel(status: LiveSubagentStatus, t: Translate): string {
  switch (status) {
    case 'running':
      return t('auto.components.live-sessions.activity.running', 'Running')
    case 'completed':
      return t('auto.components.live-sessions.activity.completed', 'Finished')
    case 'failed':
      return t('auto.components.live-sessions.activity.failed', 'Failed')
    case 'stopped':
      return t('auto.components.live-sessions.activity.stopped', 'Stopped')
  }
}

function SubagentRow({
  subagent,
  now,
  open,
  onOpen
}: {
  subagent: LiveSubagent
  now: number
  open: boolean
  onOpen: (subagentId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const since = subagent.lastActivityAt ?? subagent.startedAt
  const meta = [
    subagent.agentType,
    subagent.model,
    subagent.background
      ? t('auto.components.live-sessions.activity.background', 'background')
      : null,
    liveRunStatusLabel(subagent.status, t),
    since ? formatShortTimeAgo(since, now) : null
  ].filter(Boolean)
  return (
    <li
      data-live-subagent={subagent.id}
      data-current={open ? 'true' : undefined}
      className={cn('flex flex-col gap-1 rounded-md px-3 py-2', open && 'bg-accent')}
    >
      <div className="flex items-start gap-2">
        <span className="flex h-5 shrink-0 items-center">
          <AgentStateDot
            state={runDotState(subagent.status)}
            title={liveRunStatusLabel(subagent.status, t)}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] leading-5 font-medium break-words">{subagent.title}</span>
          <span className="text-xs text-muted-foreground">{meta.join(' \u00b7 ')}</span>
        </div>
      </div>
      {subagent.activity ? (
        <p className="truncate pl-[18px] font-mono text-2xs text-muted-foreground">
          {subagent.activity}
        </p>
      ) : null}
      {subagent.transcriptPath ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="ml-2.5 self-start"
          onClick={() => onOpen(subagent.id)}
        >
          <FileText className="size-3.5" />
          {open
            ? t('auto.components.live-sessions.activity.transcriptOpen', 'Transcript open')
            : t('auto.components.live-sessions.activity.openTranscript', 'Open transcript')}
        </Button>
      ) : null}
    </li>
  )
}

function SubagentList({
  subagents,
  now,
  openSubagentId,
  onOpen
}: {
  subagents: readonly LiveSubagent[]
  now: number
  openSubagentId: string | null
  onOpen: (subagentId: string) => void
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-0.5 p-1">
      {subagents.map((subagent) => (
        <SubagentRow
          key={subagent.id}
          subagent={subagent}
          now={now}
          open={subagent.id === openSubagentId}
          onOpen={onOpen}
        />
      ))}
    </ul>
  )
}

/** Running subagents stay in view; those that ended fold away until asked for. */
function SubagentsPanelBody({
  activity,
  now,
  openSubagentId,
  onOpen
}: {
  activity: LiveSessionActivity | undefined
  now: number
  openSubagentId: string | null
  onOpen: (subagentId: string) => void
}): React.JSX.Element {
  const t = useTranslate()
  const subagents = activity?.subagents ?? []
  if (subagents.length === 0) {
    return (
      <Empty>
        {t(
          'auto.components.live-sessions.activity.noSubagents',
          'This session has not started any subagents.'
        )}
      </Empty>
    )
  }
  const running = runningSubagents(activity)
  const ended = subagents.filter((subagent) => subagent.status !== 'running')
  return (
    <>
      {running.length > 0 ? (
        <SubagentList
          subagents={running}
          now={now}
          openSubagentId={openSubagentId}
          onOpen={onOpen}
        />
      ) : (
        <Empty>
          {t('auto.components.live-sessions.activity.noRunningSubagents', 'No subagents running.')}
        </Empty>
      )}
      {ended.length > 0 ? (
        <Collapsible data-live-subagents-ended="">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center gap-1.5 px-3 pt-3 pb-1 text-left text-2xs font-semibold tracking-wider text-muted-foreground uppercase outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <ChevronRight
                aria-hidden
                className="size-3 shrink-0 group-data-[state=open]:rotate-90"
              />
              <span className="flex-1">
                {t('auto.components.live-sessions.activity.endedSubagents', 'Previous')}
              </span>
              <span className="tabular-nums">{ended.length}</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SubagentList
              subagents={ended}
              now={now}
              openSubagentId={openSubagentId}
              onOpen={onOpen}
            />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </>
  )
}

function TaskRow({ task, now }: { task: LiveBackgroundTask; now: number }): React.JSX.Element {
  const t = useTranslate()
  return (
    <li data-live-task={task.id} className="flex items-start gap-2 px-3 py-1.5">
      <span className="flex h-5 shrink-0 items-center">
        <AgentStateDot
          state={runDotState(task.status)}
          title={liveRunStatusLabel(task.status, t)}
        />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-mono text-xs leading-5 break-all">{task.label}</span>
        <span className="text-xs text-muted-foreground">
          {[
            liveRunStatusLabel(task.status, t),
            task.summary,
            task.startedAt ? formatShortTimeAgo(task.startedAt, now) : null
          ]
            .filter(Boolean)
            .join(' \u00b7 ')}
        </span>
      </div>
    </li>
  )
}

function TodoRow({ todo }: { todo: LiveTodo }): React.JSX.Element {
  const Icon =
    todo.status === 'completed' ? Check : todo.status === 'in_progress' ? CircleDot : Circle
  return (
    <li data-live-todo={todo.status} className="flex items-start gap-2 px-3 py-1">
      <Icon
        className={cn(
          'mt-0.5 size-3.5 shrink-0',
          todo.status === 'in_progress' ? 'text-agent-working' : 'text-muted-foreground'
        )}
      />
      <span
        className={cn(
          'text-xs leading-5',
          todo.status === 'completed' && 'text-muted-foreground line-through',
          todo.status === 'in_progress' && 'font-medium'
        )}
      >
        {todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content}
      </span>
    </li>
  )
}

/** Two to-dos may read the same; the nth of a kind keeps its key as the list changes around it. */
function keyedTodos<T extends { content: string }>(
  todos: readonly T[]
): { key: string; todo: T }[] {
  const seen = new Map<string, number>()
  return todos.map((todo) => {
    const nth = seen.get(todo.content) ?? 0
    seen.set(todo.content, nth + 1)
    return { key: `${todo.content}#${nth}`, todo }
  })
}

type AgentSessionActivityPanelProps = {
  panel: AgentSessionActivityPanelKind
  provider: LiveSession['provider']
  activity: LiveSessionActivity | undefined
  /** The subagent whose transcript is showing. */
  openSubagentId: string | null
  onOpenSubagent: (subagentId: string) => void
  onClose: () => void
  now: number
}

/** Beside a session's chat: its subagents, or its background tasks and plan. */
export function AgentSessionActivityPanel({
  panel,
  provider,
  activity,
  openSubagentId,
  onOpenSubagent,
  onClose,
  now
}: AgentSessionActivityPanelProps): React.JSX.Element {
  const t = useTranslate()
  const tasks = activity?.tasks ?? []
  const todos = activity?.todos ?? []
  const leftover = liveSessionLeftoverLabel({ activity })
  const titles: Record<AgentSessionActivityPanelKind, string> = {
    subagents: t('auto.components.live-sessions.activity.subagents', 'Subagents'),
    tasks: t('auto.components.live-sessions.activity.tasks', 'Tasks')
  }
  return (
    <AgentSessionSidePanel panel={panel} title={titles[panel]} onClose={onClose}>
      {panel === 'subagents' ? (
        <SubagentsPanelBody
          activity={activity}
          now={now}
          openSubagentId={openSubagentId}
          onOpen={onOpenSubagent}
        />
      ) : null}
      {panel === 'tasks' ? (
        <>
          <SectionTitle>
            {t('auto.components.live-sessions.activity.backgroundTasks', 'Background tasks')}
          </SectionTitle>
          {leftover ? (
            <p data-live-session-leftover className="px-3 pb-1 text-xs text-muted-foreground">
              {leftover}
            </p>
          ) : null}
          {tasks.length > 0 ? (
            <ul>
              {tasks.map((task) => (
                <TaskRow key={task.id} task={task} now={now} />
              ))}
            </ul>
          ) : (
            <Empty>
              {t(
                'auto.components.live-sessions.activity.noTasks',
                'No background commands or tasks.'
              )}
            </Empty>
          )}
          <SectionTitle>
            {provider === 'codex'
              ? t('auto.components.live-sessions.activity.plan', 'Plan')
              : t('auto.components.live-sessions.activity.todos', 'To-dos')}
          </SectionTitle>
          {todos.length > 0 ? (
            <ul>
              {keyedTodos(todos).map(({ key, todo }) => (
                <TodoRow key={key} todo={todo} />
              ))}
            </ul>
          ) : (
            <Empty>
              {t('auto.components.live-sessions.activity.noTodos', 'The agent keeps no list.')}
            </Empty>
          )}
        </>
      ) : null}
    </AgentSessionSidePanel>
  )
}
