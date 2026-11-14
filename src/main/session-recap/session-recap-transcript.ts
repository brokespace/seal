import type { NativeChatMessage } from '../../shared/native-chat/native-chat-types'
import { isEditToolName } from '../../shared/native-chat/tools/native-chat-edit-normalize'
import { createToolInputDisplay } from '../../shared/native-chat/tools/native-chat-tool-summary'
import type {
  RecapReference,
  RecapReferenceKind
} from '../../shared/session-recap/session-recap-types'
import { clipProseMiddle, sessionProse } from '../session-summaries/session-summary-text'

/** One thing said: a user message, or an agent turn's own words merged into one. */
export type RecapEntry = {
  /** The message a recap item links to; for an agent turn, the last one that says anything. */
  messageId: string
  role: 'user' | 'agent'
  text: string
  at: number | null
}

export type RecapDigest = {
  entries: RecapEntry[]
  /** Files the agent edited and URLs either side wrote, without their timestamps resolved. */
  references: Omit<RecapReference, 'at'>[]
}

const USER_HEAD_CHARS = 1000
const USER_TAIL_CHARS = 500
// An agent turn ends on its outcome and any question, so the end gets the room.
const AGENT_HEAD_CHARS = 600
const AGENT_TAIL_CHARS = 1200
const MAX_LABEL_CHARS = 64
const URL = /https?:\/\/[^\s<>()[\]"'`]+/g
const PULL_REQUEST = /\/(?:pull|merge_requests|pullrequest|pull-requests)\/(\d+)/
const GITHUB_PULL = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/

function textOf(message: NativeChatMessage): string {
  return message.blocks
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')
    .trim()
}

function clipLabel(label: string): string {
  return label.length > MAX_LABEL_CHARS ? `\u2026${label.slice(-(MAX_LABEL_CHARS - 1))}` : label
}

function urlReference(url: string, messageId: string): Omit<RecapReference, 'at'> {
  const target = url.replace(/[.,;:!?]+$/, '')
  const github = GITHUB_PULL.exec(target)
  const pull = PULL_REQUEST.exec(target)
  const kind: RecapReferenceKind = pull ? 'pr' : 'link'
  const bare = target.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return {
    kind,
    label: github ? `${github[1]}#${github[2]}` : clipLabel(bare),
    target,
    messageId
  }
}

function fileReferences(message: NativeChatMessage): Omit<RecapReference, 'at'>[] {
  return message.blocks.flatMap((block) => {
    if (block.type !== 'tool-call' || !isEditToolName(block.name)) {
      return []
    }
    // Only the path is read: what the tool wrote or printed never leaves the transcript.
    const path = createToolInputDisplay(block.input).filePath
    return path
      ? [
          {
            kind: 'file' as const,
            label: clipLabel(path.split(/[\\/]/).slice(-2).join('/')),
            target: path,
            messageId: message.id
          }
        ]
      : []
  })
}

/**
 * What a recap pass reads from a run of transcript messages: the user's messages and the agent's
 * own words, never tool calls, tool output or reasoning.
 */
export function digestTranscript(messages: readonly NativeChatMessage[]): RecapDigest {
  const entries: RecapEntry[] = []
  const references: Omit<RecapReference, 'at'>[] = []
  let turn: { messageId: string; parts: string[]; at: number | null } | null = null

  const closeTurn = (): void => {
    if (turn && turn.parts.length > 0) {
      entries.push({
        messageId: turn.messageId,
        role: 'agent',
        text: clipProseMiddle(turn.parts.join('\n\n'), AGENT_HEAD_CHARS, AGENT_TAIL_CHARS),
        at: turn.at
      })
    }
    turn = null
  }

  for (const message of messages) {
    if (message.role === 'assistant') {
      references.push(...fileReferences(message))
      const prose = sessionProse(textOf(message))
      if (prose) {
        references.push(...(prose.match(URL) ?? []).map((url) => urlReference(url, message.id)))
        turn ??= { messageId: message.id, parts: [], at: message.timestamp }
        turn.messageId = message.id
        turn.at = message.timestamp ?? turn.at
        turn.parts.push(prose)
      }
      continue
    }
    // Another agent's message, a slash command or a launch fact is not something the user asked.
    if (message.role !== 'user' || message.from || message.command || message.agentStart) {
      continue
    }
    const prose = sessionProse(textOf(message))
    if (!prose) {
      continue
    }
    closeTurn()
    references.push(...(prose.match(URL) ?? []).map((url) => urlReference(url, message.id)))
    entries.push({
      messageId: message.id,
      role: 'user',
      text: clipProseMiddle(prose, USER_HEAD_CHARS, USER_TAIL_CHARS),
      at: message.timestamp
    })
  }
  closeTurn()
  return { entries, references }
}

/** Entries in chunks of at most `chunkChars`, oldest first; past `maxChunks` the oldest are left out. */
export function chunkRecapEntries(
  entries: readonly RecapEntry[],
  chunkChars: number,
  maxChunks: number
): { chunks: RecapEntry[][]; dropped: number } {
  const chunks: RecapEntry[][] = []
  let size = 0
  let index = entries.length
  // Filled from the newest back, so what is dropped is always the oldest.
  while (index > 0) {
    const entry = entries[index - 1]
    const first = chunks[0]
    if (!first || size + entry.text.length > chunkChars) {
      if (chunks.length === maxChunks) {
        break
      }
      chunks.unshift([entry])
      size = entry.text.length
    } else {
      first.unshift(entry)
      size += entry.text.length
    }
    index--
  }
  return { chunks, dropped: index }
}
