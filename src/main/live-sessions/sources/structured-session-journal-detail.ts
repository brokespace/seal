import type { AgentJournalRenderItem } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { selectStructuredAgentContextUsage } from '../../../shared/agent-session/structured-agent-session-context-usage'
import { statusStructuredAgentSessionToolCall } from '../../../shared/agent-session/view/structured-agent-session-live-turn'
import { projectStructuredItemsToNativeChat } from '../../../shared/agent-session/view/structured-agent-session-projection'
import type { LiveTodo } from '../../../shared/live-sessions/live-session-activity'
import { nativeChatDockedTaskList } from '../../../shared/native-chat/input/native-chat-task-list-state'
import {
  summarizeContextUsage,
  type NativeChatContextUsageSummary
} from '../../../shared/native-chat/native-chat-context-usage-summary'
import type { StructuredToolInFlight } from './structured-session-evidence'

/** What only a chat's journal items say: read off the event path, kept until the next read. */
export type StructuredSessionJournalDetail = {
  toolInFlight: StructuredToolInFlight | null
  todos: LiveTodo[]
  context: NativeChatContextUsageSummary | null
}

export function structuredSessionJournalDetail(
  items: readonly AgentJournalRenderItem[]
): StructuredSessionJournalDetail {
  const tool = statusStructuredAgentSessionToolCall(items)
  const usage = selectStructuredAgentContextUsage(items)
  const plan = nativeChatDockedTaskList(projectStructuredItemsToNativeChat(items))
  return {
    toolInFlight: tool?.state === 'running' ? { name: tool.name, input: tool.input } : null,
    todos: (plan?.tasks ?? []).map(({ content, status, activeForm }) => ({
      content,
      status,
      ...(activeForm ? { activeForm } : {})
    })),
    context: usage ? summarizeContextUsage(usage) : null
  }
}

export type StructuredSessionJournalDetails = {
  get(sessionId: string): StructuredSessionJournalDetail | null
  /** Reads the chat's journal again; reads of one chat never overlap. */
  refresh(sessionId: string): void
  forget(sessionId: string): void
}

export function createStructuredSessionJournalDetails(deps: {
  /** Null when the chat's journal is not open: listing a chat never opens one. */
  read(sessionId: string): Promise<readonly AgentJournalRenderItem[]> | null
  onChange(sessionId: string): void
  log(message: string, error?: unknown): void
}): StructuredSessionJournalDetails {
  const details = new Map<string, StructuredSessionJournalDetail>()
  /** Chats with a read under way; true when another was asked for meanwhile. */
  const reading = new Map<string, boolean>()

  const refresh = (sessionId: string): void => {
    if (reading.has(sessionId)) {
      reading.set(sessionId, true)
      return
    }
    const read = deps.read(sessionId)
    if (!read) {
      return
    }
    reading.set(sessionId, false)
    void read
      .then((items) => {
        details.set(sessionId, structuredSessionJournalDetail(items))
        deps.onChange(sessionId)
      })
      .catch((error: unknown) => deps.log(`Could not read chat ${sessionId}'s journal.`, error))
      .finally(() => {
        const again = reading.get(sessionId)
        reading.delete(sessionId)
        if (again) {
          refresh(sessionId)
        }
      })
  }

  return {
    get: (sessionId) => details.get(sessionId) ?? null,
    refresh,
    forget: (sessionId) => {
      details.delete(sessionId)
    }
  }
}
