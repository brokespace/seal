import type {
  NativeChatBlock,
  NativeChatMessage
} from '../../../shared/native-chat/native-chat-types'
import type {
  LiveSessionProvider,
  LiveTranscriptPage
} from '../../../shared/live-sessions/live-session-types'
import { decodeClaudeTranscriptLine } from '../../native-chat/transcript-decoding/transcript-line-decoders-claude'
import { decodeCodexTranscriptLine } from '../../native-chat/transcript-decoding/transcript-line-decoders-codex'
import {
  classifyLiveTranscriptRecord,
  cleanLiveTranscriptMessage,
  summarizedDivider
} from './live-transcript-cleanup'
import { codexRawReasoning, withReasoningSpan } from './live-transcript-reasoning'
import { parseJsonRecord } from '../../../shared/live-sessions/transcript-json-record'
import { liveTranscriptImageUrl } from '../../../shared/live-sessions/live-transcript-image-ref'
import { readElidedRun } from './transcript-base64-elision'
import type { TranscriptLine, TranscriptSource } from './transcript-file-source'

export type TranscriptDecodeOptions = {
  /** Reading a subagent's own transcript, where every record is a sidechain record. */
  subagent?: boolean
}

export function decodeTranscriptLines(
  provider: LiveSessionProvider,
  lines: TranscriptLine[],
  options: TranscriptDecodeOptions = {}
): NativeChatMessage[] {
  const decode = provider === 'claude' ? decodeClaudeTranscriptLine : decodeCodexTranscriptLine
  return lines.flatMap(({ offset, text }) => {
    const kind = classifyLiveTranscriptRecord(provider, text, options)
    if (kind === 'hidden') {
      return []
    }
    // Offsets are the same in every read of the file, so they key messages across reconnects.
    const id = `o${offset}`
    const record = parseJsonRecord(text)
    const decoded =
      kind === 'summarized'
        ? summarizedDivider(id, null)
        : (decode(text, id) ??
          (record && provider === 'codex' ? codexRawReasoning(record, id) : null))
    return (decoded ? cleanLiveTranscriptMessage({ ...decoded, id }) : []).map((message) => {
      const row = record ? withReasoningSpan(message, record) : message
      return {
        ...row,
        blocks: row.blocks.map((block) => withImageReference(block, offset)),
        transcriptOffset: offset,
        transcriptOrder: offset
      }
    })
  })
}

const ELIDED_IMAGE = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/

/** An inline image whose base64 the reader left in the file is named by where that base64 sits. */
function withImageReference(block: NativeChatBlock, lineOffset: number): NativeChatBlock {
  if (block.type !== 'image-ref' || !block.url) {
    return block
  }
  const image = ELIDED_IMAGE.exec(block.url)
  const run = image ? readElidedRun(image[2]) : null
  return image && run
    ? {
        ...block,
        url: liveTranscriptImageUrl({
          mimeType: image[1],
          start: lineOffset + run.at,
          length: run.length
        })
      }
    : block
}

/** A page stops growing past this much record text, so one reply stays under every frame cap. */
const PAGE_TEXT_BYTES = 1536 * 1024

const textBytes = (lines: TranscriptLine[]): number =>
  lines.reduce((bytes, line) => bytes + line.text.length, 0)

/** Messages before `before` (the file's end when null), newest `limit` of them. */
export async function readTranscriptPage(
  source: TranscriptSource,
  provider: LiveSessionProvider,
  sessionId: string,
  before: number | null,
  limit: number,
  options: TranscriptDecodeOptions = {}
): Promise<LiveTranscriptPage> {
  let read = await source.linesBefore(before)
  const cursor = before === null ? read.end : Math.min(before, read.size)
  let messages = decodeTranscriptLines(provider, read.lines, options)
  let text = textBytes(read.lines)
  while (read.start > 0 && messages.length < limit && text < PAGE_TEXT_BYTES) {
    read = await source.linesBefore(read.start)
    messages = [...decodeTranscriptLines(provider, read.lines, options), ...messages]
    text += textBytes(read.lines)
  }
  let start = read.start
  if (messages.length > limit) {
    messages = messages.slice(-limit)
    start = messages[0].transcriptOffset ?? start
  }
  return { sessionId, messages, cursor, start, more: start > 0 }
}

export type ForwardRead = {
  messages: NativeChatMessage[]
  lines: TranscriptLine[]
  cursor: number
  size: number
  /** The file is now shorter than the cursor: it was rewritten. */
  shrank: boolean
}

/** Messages from `cursor` on, up to whole lines only; the cursor never splits a record. */
export async function readTranscriptForward(
  source: TranscriptSource,
  provider: LiveSessionProvider,
  cursor: number,
  options: TranscriptDecodeOptions = {}
): Promise<ForwardRead> {
  const { size, lines, end } = await source.linesFrom(cursor)
  if (size < cursor) {
    return { messages: [], lines: [], cursor, size, shrank: true }
  }
  return {
    messages: decodeTranscriptLines(provider, lines, options),
    lines,
    cursor: end,
    size,
    shrank: false
  }
}
