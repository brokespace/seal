import type { AgentSessionStatusSummary } from '../../../shared/agent-session/agent-session-wire'
import type { AgentChildWorkView } from '../../../shared/agent-status/child-work/agent-status-child-work-view'
import type {
  LiveBackgroundTask,
  LiveSessionActivity,
  LiveSubagent,
  LiveSubagentStatus,
  LiveTodo
} from '../../../shared/live-sessions/live-session-activity'
import { oneLine } from '../discovery/transcript-records'

type ChildKind = AgentChildWorkView['kind']

/** Agents and workflows think for themselves; every other child is a task the agent started. */
function isSubagentKind(kind: ChildKind): boolean {
  return kind === 'agent' || kind === 'workflow'
}

function childStatus(child: AgentChildWorkView): LiveSubagentStatus {
  if (child.membership === 'live') {
    return 'running'
  }
  return child.outcome === 'succeeded'
    ? 'completed'
    : child.outcome === 'failed'
      ? 'failed'
      : 'stopped'
}

function childActivity(child: AgentChildWorkView): string | null {
  if (child.operation) {
    const { toolName, input } = child.operation
    return oneLine(input ? `${toolName}: ${input}` : toolName)
  }
  return child.lastMessage ? oneLine(child.lastMessage) : null
}

type ChildWork = Pick<LiveSessionActivity, 'subagents' | 'tasks'>

function fromChildren(children: readonly AgentChildWorkView[]): ChildWork {
  const subagents: LiveSubagent[] = []
  const tasks: LiveBackgroundTask[] = []
  for (const child of children) {
    const status = childStatus(child)
    if (isSubagentKind(child.kind)) {
      subagents.push({
        id: child.id,
        title: child.name ?? child.description ?? child.agentType ?? 'Subagent',
        agentType: child.agentType ?? null,
        model: child.model ?? null,
        status,
        // The host's view does not say whether a child blocks its turn.
        background: false,
        activity: childActivity(child),
        startedAt: child.firstObservedAt,
        lastActivityAt: child.observedAt,
        transcriptPath: null
      })
    } else {
      tasks.push({
        id: child.id,
        label: child.description ?? child.name ?? child.kind,
        status,
        startedAt: child.firstObservedAt,
        summary: null
      })
    }
  }
  return { subagents, tasks }
}

/** Hosts that publish no child views still list their live tasks. */
function fromBackgroundTasks(
  listed: NonNullable<AgentSessionStatusSummary['backgroundTasks']>
): ChildWork {
  const subagents: LiveSubagent[] = []
  const tasks: LiveBackgroundTask[] = []
  for (const task of listed) {
    const status: LiveSubagentStatus = task.state === 'done' ? 'completed' : 'running'
    const startedAt = task.startedAt ?? null
    if (isSubagentKind(task.kind)) {
      subagents.push({
        id: task.id,
        title: task.name ?? task.description ?? 'Subagent',
        agentType: null,
        model: null,
        status,
        background: false,
        activity: null,
        startedAt,
        lastActivityAt: null,
        transcriptPath: null
      })
    } else {
      tasks.push({
        id: task.id,
        label: task.description ?? task.name ?? task.kind,
        status,
        startedAt,
        summary: null
      })
    }
  }
  return { subagents, tasks }
}

/** What a chat has going on besides its turn; `todos` is the plan its journal holds. */
export function structuredSessionActivity(
  summary: Pick<AgentSessionStatusSummary, 'children' | 'backgroundTasks'>,
  todos: readonly LiveTodo[]
): LiveSessionActivity {
  const work = summary.children
    ? fromChildren(summary.children)
    : fromBackgroundTasks(summary.backgroundTasks ?? [])
  return { ...work, todos: [...todos] }
}
