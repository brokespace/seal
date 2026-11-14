// What a live session has going on besides its main turn: subagents, background tasks, its plan.

export const LIVE_SUBAGENT_STATUSES = ['running', 'completed', 'failed', 'stopped'] as const
export type LiveSubagentStatus = (typeof LIVE_SUBAGENT_STATUSES)[number]

export type LiveSubagent = {
  /** Claude: the id in `subagents/agent-<id>.jsonl`, else its tool call; Codex: the child thread. */
  id: string
  title: string
  agentType: string | null
  model: string | null
  status: LiveSubagentStatus
  /** Launched to run alongside the main turn rather than block it. */
  background: boolean
  /** One line on what it is doing now, or last did. */
  activity: string | null
  startedAt: number | null
  lastActivityAt: number | null
  /** Its own transcript on the session's machine, when it writes one. */
  transcriptPath: string | null
}

export type LiveBackgroundTask = {
  id: string
  /** The command line, or what the agent called the task. */
  label: string
  status: LiveSubagentStatus
  startedAt: number | null
  /** How it ended, in the agent's words ("exit code 1"). */
  summary: string | null
}

export const LIVE_TODO_STATUSES = ['pending', 'in_progress', 'completed'] as const
export type LiveTodoStatus = (typeof LIVE_TODO_STATUSES)[number]

export type LiveTodo = {
  content: string
  status: LiveTodoStatus
  /** The present-tense form shown while it is in progress ("Running tests"). */
  activeForm?: string
}

export type LiveSessionActivity = {
  subagents: LiveSubagent[]
  tasks: LiveBackgroundTask[]
  /** The agent's own todo list or plan, newest version. */
  todos: LiveTodo[]
}

export const EMPTY_LIVE_SESSION_ACTIVITY: LiveSessionActivity = {
  subagents: [],
  tasks: [],
  todos: []
}

export function runningSubagents(activity: LiveSessionActivity | undefined): LiveSubagent[] {
  return (activity?.subagents ?? []).filter((subagent) => subagent.status === 'running')
}

export function runningBackgroundTasks(
  activity: LiveSessionActivity | undefined
): LiveBackgroundTask[] {
  return (activity?.tasks ?? []).filter((task) => task.status === 'running')
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "Waiting on 2 subagents and 1 background task"; null when nothing runs in the background. */
export function backgroundWaitLabel(subagents: number, tasks: number): string | null {
  const parts = [
    ...(subagents > 0 ? [counted(subagents, 'subagent', 'subagents')] : []),
    ...(tasks > 0 ? [counted(tasks, 'background task', 'background tasks')] : [])
  ]
  return parts.length > 0 ? `Waiting on ${parts.join(' and ')}` : null
}

const SUBAGENT_TRANSCRIPT_MARK = '#subagent:'

/** A subagent's transcript is read through the session API under this id. */
export function subagentTranscriptId(sessionId: string, subagentId: string): string {
  return `${sessionId}${SUBAGENT_TRANSCRIPT_MARK}${subagentId}`
}

export function parseSubagentTranscriptId(id: string): {
  sessionId: string
  subagentId: string | null
} {
  const at = id.lastIndexOf(SUBAGENT_TRANSCRIPT_MARK)
  return at === -1
    ? { sessionId: id, subagentId: null }
    : {
        sessionId: id.slice(0, at),
        subagentId: id.slice(at + SUBAGENT_TRANSCRIPT_MARK.length)
      }
}
