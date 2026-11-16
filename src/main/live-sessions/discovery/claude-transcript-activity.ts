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
}

export function newClaudeActivityState(): ClaudeActivityState {
  return {
    agents: new Map(),
    background: new Map(),
    tasks: new Map(),
    creating: new Map(),
    todos: null,
    ended: new Map()
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

function finish(
  state: ClaudeActivityState,
  ids: (string | null)[],
  status: LiveSubagentStatus,
  summary: string | null
): void {
  const known = ids.filter((id): id is string => id !== null)
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
    finish(state, [str(input?.shell_id), str(input?.task_id), str(input?.bash_id)], 'stopped', null)
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
    settleBackgroundLaunch(state.background, launch, outcome)
    return
  }
  const creating = state.creating.get(id)
  const taskId = str(rec(outcome?.task)?.id)
  if (creating && taskId) {
    state.tasks.set(taskId, state.tasks.get(taskId) ?? creating)
    state.creating.delete(id)
  }
}

/** Folds main-thread records, oldest first, into the state. */
export function foldClaudeActivity(state: ClaudeActivityState, records: TranscriptRecord[]): void {
  for (const record of records) {
    if (record.isSidechain === true) {
      continue
    }
    const notification = notificationOf(record)
    if (notification) {
      const ended = backgroundTaskEnd(tag(notification, 'status'))
      const taskId = tag(notification, 'task-id')
      const summary = tag(notification, 'summary')
      if (ended) {
        finish(state, [taskId, tag(notification, 'tool-use-id')], ended, summary)
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
        finish(state, [str(origin.from)], 'completed', null)
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
