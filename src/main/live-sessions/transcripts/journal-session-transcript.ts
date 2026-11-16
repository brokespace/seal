import { compareAgentJournalItems } from '../../../shared/agent-session/journal/agent-session-journal-position'
import { isRootAgentJournalItem } from '../../../shared/agent-session/journal/agent-session-journal-producer'
import type {
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../../shared/agent-session/journal/agent-session-journal-types'
import { projectStructuredItemToNativeChat } from '../../../shared/agent-session/view/structured-agent-session-projection'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import type { SessionTranscript } from './session-transcript'

export type ChatJournalRead = {
  snapshot(): Promise<Pick<AgentJournalSnapshot, 'cursor' | 'items'>>
  /** A turn is running: its newest item may still be revised. */
  working(): boolean
}

const DEFAULT_PAGE = 80

type Settled = {
  /** The chat's own conversation, oldest first; a subagent's rows are its own transcript. */
  messages: NativeChatMessage[]
  /** The journal sequence everything in `messages` is at or before. */
  through: number
  head: number
}

/** A row a running turn may still revise: a tool call or reasoning in progress, or the turn's newest row. */
function unsettled(item: AgentJournalRenderItem, newest: boolean): boolean {
  const { body } = item
  return (
    newest || ((body.kind === 'tool-call' || body.kind === 'message') && body.state === 'running')
  )
}

/** A journal row keeps its sequence when revised, so a reader past it never sees it finish: while a turn runs, reading stops before the first row still being written. */
function settled(
  snapshot: Pick<AgentJournalSnapshot, 'cursor' | 'items'>,
  working: boolean
): Settled {
  const root = snapshot.items.filter((item) => isRootAgentJournalItem(item))
  root.sort(compareAgentJournalItems)
  const head = snapshot.cursor.sequence
  // Only a running turn holds rows back: a call left "running" by a crash must not hide what follows it.
  const open = working
    ? root.find((item, index) => unsettled(item, index === root.length - 1))
    : undefined
  const through = open ? open.sequence - 1 : head
  const messages = root.flatMap((item) => {
    const message = item.sequence <= through ? projectStructuredItemToNativeChat(item) : null
    // Rows of one write share a sequence, as split projections of one file record share an offset.
    return message ? [{ ...message, transcriptOffset: item.sequence }] : []
  })
  return { messages, through, head }
}

const sequenceOf = (message: NativeChatMessage): number => message.transcriptOffset ?? 0

/**
 * A chat's journal read the way a transcript file is: cursors are journal sequences, and message
 * ids are journal item ids, which a chat view finds its rows by.
 */
export function journalSessionTranscript(
  recordId: string,
  read: ChatJournalRead
): SessionTranscript {
  const current = async (): Promise<Settled> => settled(await read.snapshot(), read.working())
  return {
    async page(before, limit = DEFAULT_PAGE) {
      const { messages, through } = await current()
      const older = before === null ? messages : messages.filter((m) => sequenceOf(m) < before)
      let first = Math.max(0, older.length - limit)
      // A page never splits the rows of one write: paging back by sequence would skip the rest.
      while (first > 0 && sequenceOf(older[first - 1]) === sequenceOf(older[first])) {
        first--
      }
      const page = older.slice(first)
      return {
        sessionId: recordId,
        messages: page,
        cursor: through,
        // A file's first page starts at byte 0; a journal's first row has a later sequence.
        start: first > 0 ? sequenceOf(page[0]) : 0,
        more: first > 0
      }
    },
    async since(cursor) {
      const { messages, through, head } = await current()
      // A journal started over counts from the beginning, as a rewritten file is shorter.
      if (cursor > head) {
        return { messages: [], cursor, shrank: true }
      }
      return {
        messages: messages.filter((m) => sequenceOf(m) > cursor),
        cursor: Math.max(cursor, through),
        shrank: false
      }
    }
  }
}

/** The journal of a chat this host holds, read without starting its agent. */
export function structuredChatJournal(
  chatSessionId: string,
  recordId: string
): SessionTranscript | null {
  const host = getStructuredAgentSessionHost()
  if (!host?.deps.store.getRecord(chatSessionId)) {
    return null
  }
  return journalSessionTranscript(recordId, {
    snapshot: () => host.journalSnapshot(chatSessionId),
    working: () => host.readStatusSummary(chatSessionId)?.status === 'working'
  })
}
