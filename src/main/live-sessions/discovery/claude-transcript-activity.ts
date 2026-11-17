// What a Claude Code session started besides its main turn, folded from its transcript records:
// Agent/Task subagents, background tasks, and its todo list. Folding the same records twice is safe.
import type {
  LiveSubagentStatus,
  LiveTodo,
  LiveTodoStatus
} from '../../../shared/live-sessions/live-session-activity'
import { LIVE_TODO_STATUSES } from '../../../shared/live-sessions/live-session-activity'
import {
  backgroundTaskEnd,
  dropForegroundCallsBefore,
  endDetachingLaunch,
  endWakeupsBefore,
  noteRunningTask,
  openBackgroundLaunch,
  settleBackgroundLaunch,
  type ClaudeBackgroundLaunches
} from './claude-background-launches'
import { CLAUDE_SUBAGENT_TOOLS, claudePromptText } from './claude-transcript-phase'
import { blocks, contentText, oneLine, rec, str, timeOf } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

export type ClaudeAgentLaunch = {
  toolUseId: string
  agentId: string | null
  title: string
  agentType: string | null
  model: string | null
  background: boolean
  status: LiveSubagentStatus
  startedAt: number | null
}

export type ClaudeActivityState = {
  agents: Map<string, ClaudeAgentLaunch>
  /** Shells, monitors, workflows and wake-ups, by the call that launched them. */
  background: ClaudeBackgroundLaunches
  /** TaskCreate/TaskUpdate's list, by task id. */
  tasks: Map<string, LiveTodo>
  /** TaskCreate calls whose result has not named their task yet. */
  creating: Map<string, LiveTodo>
  /** TodoWrite's list: each call replaces it. */
  todos: LiveTodo[] | null
  /** Background work reported finished whose launch this state never saw, by task and tool id. */
  ended: Map<string, LiveSubagentStatus>
  /**
   * Subagents that stopped to wait on background work of their own, and when (epoch ms), by task
   * and tool id: Claude Code resumes one when that work reports, and it notifies again.
   */
  parked: Map<string, number>
  /** When the user last spoke or interrupted: what was launched since is the newest turn's own. */
  userSpokeAt: number | null
}

export function newClaudeActivityState(): ClaudeActivityState {
  return {
    agents: new Map(),
    background: new Map(),
    tasks: new Map(),
    creating: new Map(),
    todos: null,
    ended: new Map(),
    parked: new Map(),
    userSpokeAt: null
  }
}

function todoStatus(value: unknown): LiveTodoStatus {
  return LIVE_TODO_STATUSES.find((status) => status === value) ?? 'pending'
}

function todoOf(value: unknown): LiveTodo | null {
  const item = rec(value)
  const content = str(item?.content) ?? str(item?.subject)
  if (!content) {
    return null
  }
  const activeForm = str(item?.activeForm)
  return {
    content: oneLine(content, 200),
    status: todoStatus(item?.status),
    ...(activeForm ? { activeForm: oneLine(activeForm, 200) } : {})
  }
}

const NOTIFICATION = /<task-notification>([\s\S]*?)<\/task-notification>/

function tag(xml: string, name: string): string | null {
  return new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1]?.trim() || null
}

/** The text of a `<task-notification>` this record delivers, as a queued command or a user turn. */
function notificationOf(record: TranscriptRecord): string | null {
  const attachment = rec(record.attachment)
  const text =
    record.type === 'attachment' && attachment?.type === 'queued_command'
      ? typeof attachment.prompt === 'string'
        ? attachment.prompt
        : contentText(attachment.prompt)
      : record.type === 'user'
        ? contentText(rec(record.message)?.content)
        : ''
  return NOTIFICATION.exec(text)?.[1] ?? null
}

/** How a background task ended, from the record that tells its parent: the call that launched it and what it handed back. */
export function claudeTaskReport(
  record: TranscriptRecord
): { toolUseId: string; report: string } | null {
  const notification = notificationOf(record)
  if (!notification || !backgroundTaskEnd(tag(notification, 'status'))) {
    return null
  }
  const toolUseId = tag(notification, 'tool-use-id')
  const report = tag(notification, 'result') ?? tag(notification, 'summary')
  return toolUseId && report ? { toolUseId, report } : null
}

/** Claude Code 2.1.326's notice of a subagent that stopped with work of its own still running. */
const PARKED_SUMMARY = /^Agent "[\s\S]*" is waiting on its own background work$/
const PARKED_RESULT = 'This agent stopped with background work of its own still running.'

function isParked(notification: string): boolean {
  return (
    PARKED_SUMMARY.test(tag(notification, 'summary') ?? '') ||
    (tag(notification, 'result') ?? '').startsWith(PARKED_RESULT)
  )
}

/** When a subagent, by its own id or its launching call, stopped to wait on work of its own. */
export function subagentParkedAt(
  state: ClaudeActivityState | null,
  ids: (string | null)[]
): number | undefined {
  return ids
    .flatMap((id) => (id === null ? [] : [state?.parked.get(id)]))
    .find((at) => at !== undefined)
}

function finish(
  state: ClaudeActivityState,
  ids: (string | null)[],
  status: LiveSubagentStatus,
  summary: string | null,
  at: number | null
): void {
  const known = ids.filter((id): id is string => id !== null)
  known.forEach((id) => state.parked.delete(id))
  let found = false
  for (const agent of state.agents.values()) {
    if (known.includes(agent.toolUseId) || (agent.agentId && known.includes(agent.agentId))) {
      agent.status = status
      found = true
    }
  }
  for (const task of state.background.values()) {
    if (known.includes(task.toolUseId) || (task.taskId && known.includes(task.taskId))) {
      task.status = status
      task.summary = summary ?? task.summary
      // A shell that was killed took its jobs with it; one that ran to its end may have left one.
      if (status === 'stopped') {
        task.detached = null
      } else {
        endDetachingLaunch(task, at)
      }
      found = true
    }
  }
  if (!found) {
    known.forEach((id) => state.ended.set(id, status))
  }
}

function foldToolUse(state: ClaudeActivityState, tool: TranscriptRecord, at: number | null): void {
  const id = str(tool.id)
  const name = str(tool.name) ?? ''
  const input = rec(tool.input)
  if (!id) {
    return
  }
  if (CLAUDE_SUBAGENT_TOOLS.has(name)) {
    if (!state.agents.has(id)) {
      state.agents.set(id, {
        toolUseId: id,
        agentId: null,
        title: oneLine(str(input?.description) ?? str(input?.prompt) ?? 'Subagent', 100),
        agentType: str(input?.subagent_type),
        model: str(input?.model),
        background: input?.run_in_background === true,
        status: 'running',
        startedAt: at
      })
    }
    return
  }
  if (openBackgroundLaunch(state.background, { id, name, input, at })) {
    return
  }
  if (name === 'TodoWrite' && Array.isArray(input?.todos)) {
    state.todos = input.todos.map(todoOf).filter((todo) => todo !== null)
  } else if (name === 'TaskCreate') {
    const todo = todoOf(input)
    if (todo) {
      state.creating.set(id, todo)
    }
  } else if (name === 'TaskUpdate') {
    const taskId = str(input?.taskId)
    const task = taskId ? state.tasks.get(taskId) : undefined
    if (taskId && input?.status === 'deleted') {
      state.tasks.delete(taskId)
    } else if (task) {
      state.tasks.set(taskId!, {
        ...task,
        ...(str(input?.subject) ? { content: oneLine(str(input?.subject)!, 200) } : {}),
        ...(str(input?.status) ? { status: todoStatus(input?.status) } : {})
      })
    }
  } else if (name === 'KillShell' || name === 'KillBash' || name === 'TaskStop') {
    finish(
      state,
      [str(input?.shell_id), str(input?.task_id), str(input?.bash_id)],
      'stopped',
      null,
      at
    )
  }
}

function foldToolResult(
  state: ClaudeActivityState,
  result: TranscriptRecord,
  record: TranscriptRecord
): void {
  const id = str(result.tool_use_id)
  if (!id) {
    return
  }
  const outcome = rec(record.toolUseResult)
  const failed = result.is_error === true || typeof record.toolUseResult === 'string'
  const agent = state.agents.get(id)
  if (agent) {
    agent.agentId = str(outcome?.agentId) ?? agent.agentId
    if (outcome?.isAsync === true || outcome?.status === 'async_launched') {
      agent.background = true
    } else if (failed && !agent.agentId) {
      // Refused before it started (a hook, a bad argument): there never was a subagent.
      state.agents.delete(id)
    } else {
      agent.status = failed ? 'failed' : 'completed'
    }
    return
  }
  const launch = state.background.get(id)
  if (launch) {
    settleBackgroundLaunch(state.background, launch, outcome, timeOf(record))
    return
  }
  const creating = state.creating.get(id)
  const taskId = str(rec(outcome?.task)?.id)
  if (creating && taskId) {
    state.tasks.set(taskId, state.tasks.get(taskId) ?? creating)
    state.creating.delete(id)
  }
}

/**
 * Folds one thread's records, oldest first, into the state: a session's main thread, or the
 * transcript a subagent writes for itself, where every record is a sidechain's.
 */
export function foldClaudeActivity(
  state: ClaudeActivityState,
  records: TranscriptRecord[],
  thread: 'main' | 'subagent' = 'main'
): void {
  for (const record of records) {
    if (thread === 'main' && record.isSidechain === true) {
      continue
    }
    const notification = notificationOf(record)
    if (notification) {
      const ended = backgroundTaskEnd(tag(notification, 'status'))
      const taskId = tag(notification, 'task-id')
      const summary = tag(notification, 'summary')
      const ids = [taskId, tag(notification, 'tool-use-id')]
      if (ended === 'completed' && isParked(notification)) {
        ids.forEach((id) => id && state.parked.set(id, timeOf(record) ?? 0))
      } else if (ended) {
        finish(state, ids, ended, summary, timeOf(record))
      } else if (!taskId || !state.ended.has(taskId)) {
        noteRunningTask(state.background, taskId, summary)
      }
      continue
    }
    if (record.type === 'system' && record.subtype === 'scheduled_task_fire') {
      endWakeupsBefore(state.background, timeOf(record), 'completed')
      continue
    }
    const content = rec(record.message)?.content
    if (record.type === 'assistant') {
      for (const block of blocks(content)) {
        if (block.type === 'tool_use') {
          foldToolUse(state, block, timeOf(record))
        }
      }
    } else if (record.type === 'user') {
      const origin = rec(record.origin)
      if (origin?.kind === 'peer' && str(origin.from)) {
        // A subagent handed its report back; its notification follows.
        finish(state, [str(origin.from)], 'completed', null, timeOf(record))
        continue
      }
      for (const block of blocks(content)) {
        if (block.type === 'tool_result') {
          foldToolResult(state, block, record)
        }
      }
      const interrupted = contentText(content).startsWith('[Request interrupted')
      if (interrupted || claudePromptText(record)) {
        // A subagent that blocks its turn cannot outlive it. A re-folded prompt is older than
        // what its own turn launched, and must leave that running.
        const at = timeOf(record)
        state.userSpokeAt = Math.max(state.userSpokeAt ?? 0, at ?? 0) || null
        dropForegroundCallsBefore(state.background, at)
        for (const agent of state.agents.values()) {
          const launchedBefore = at === null || agent.startedAt === null || agent.startedAt <= at
          if (!agent.background && agent.status === 'running' && launchedBefore) {
            agent.status = interrupted ? 'stopped' : 'completed'
          }
        }
      }
    }
  }
}

export function claudeTodos(state: ClaudeActivityState): LiveTodo[] {
  return state.tasks.size > 0 ? [...state.tasks.values()] : (state.todos ?? [])
}
