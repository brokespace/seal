import { agentJournalSubmissionKey } from '../../../shared/agent-session/journal/agent-session-journal-item-key'
import { isRootAgentJournalItem } from '../../../shared/agent-session/journal/agent-session-journal-producer'
import type { AgentJournalSnapshot } from '../../../shared/agent-session/journal/agent-session-journal-types'
import { isTextBlock } from '../../../shared/native-chat/native-chat-types'
import type { StructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-host'
import { normalizeForMatch, type UserText } from '../delivery/transcript-user-texts'

type JournalHost = Pick<StructuredAgentSessionHost, 'journalCurrentRead' | 'queuedSendAnswer'>

/** A send the host holds as a queued card: the journal has it, and no item shows it yet. */
type QueuedSend = { sessionId: string; messageId: string; offset: number; text: string }

/** Queued sends stop being tracked after this; their items confirm them from then on. */
const QUEUED_SEND_KEEP_MS = 24 * 60 * 60_000

export type StructuredJournalTexts = {
  /** The offset the next journal row gets: the journal's last sequence plus one. */
  journalSize(sessionId: string): Promise<number>
  /** The user's messages in rows at or after `from`, each at its row's sequence. */
  userTexts(sessionId: string, from: number): Promise<UserText[]>
  /** The host queued a send behind the running turn, when the journal stood at `sequence`. */
  noteQueued(sessionId: string, messageId: string, sequence: number, text: string): void
}

/** What the chat's journal holds as said by its user, skipping sends the agent refused. */
function userItemTexts(read: AgentJournalSnapshot, from: number): UserText[] {
  const rejected = new Set(
    read.submissions
      .filter((submission) => submission.dispatchState === 'rejected')
      .map((submission) => agentJournalSubmissionKey(submission.clientMessageId))
  )
  const texts: UserText[] = []
  for (const item of read.items) {
    const { body } = item
    if (
      item.sequence < from ||
      body.kind !== 'message' ||
      body.role !== 'user' ||
      !isRootAgentJournalItem(item) ||
      rejected.has(item.itemId)
    ) {
      continue
    }
    const text = normalizeForMatch(
      body.blocks
        .filter(isTextBlock)
        .map((block) => block.text)
        .join('\n')
    )
    if (text) {
      texts.push({ offset: item.sequence, text })
    }
  }
  return texts
}

export function createStructuredJournalTexts(
  host: () => JournalHost | null,
  now: () => number = Date.now
): StructuredJournalTexts {
  const queued = new Map<string, QueuedSend & { at: number }>()

  const read = (sessionId: string): Promise<AgentJournalSnapshot> => {
    const current = host()
    if (!current) {
      throw new Error('No chat host is running.')
    }
    return current.journalCurrentRead(sessionId)
  }

  /** Cards still waiting in the host's queue; one handed over is an item by then. */
  const waitingCards = async (sessionId: string, from: number): Promise<UserText[]> => {
    const texts: UserText[] = []
    for (const [messageId, send] of queued) {
      if (now() - send.at > QUEUED_SEND_KEEP_MS) {
        queued.delete(messageId)
        continue
      }
      if (send.sessionId !== sessionId || send.offset < from) {
        continue
      }
      const answer = await host()
        ?.queuedSendAnswer(sessionId, messageId)
        .catch(() => null)
      if (answer && 'queued' in answer && answer.queued.state === 'waiting') {
        texts.push({ offset: send.offset, text: send.text })
      } else if (answer) {
        queued.delete(messageId)
      }
    }
    return texts
  }

  return {
    journalSize: async (sessionId) => (await read(sessionId)).cursor.sequence + 1,
    userTexts: async (sessionId, from) => [
      ...userItemTexts(await read(sessionId), from),
      ...(await waitingCards(sessionId, from))
    ],
    noteQueued: (sessionId, messageId, sequence, text) => {
      queued.set(messageId, {
        sessionId,
        messageId,
        offset: sequence,
        text: normalizeForMatch(text),
        at: now()
      })
    }
  }
}
