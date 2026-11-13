import { open } from 'node:fs/promises'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
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
import type { LiveSessionHost } from '../hosts/live-session-hosts'

/** Raw bytes of one range of a transcript and the file's size when read. */
export type TranscriptRange = { bytes: Buffer; size: number }

export type TranscriptSource = {
  read(start: number, length: number): Promise<TranscriptRange>
  /** The most one read may return; SSH output is capped, so remote reads stay small. */
  maxRead: number
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

export function localTranscriptSource(path: string): TranscriptSource {
  return {
    maxRead: 4 * 1024 * 1024,
    async read(start, length) {
      const handle = await open(path, 'r')
      try {
        const { size } = await handle.stat()
        const want = Math.max(0, Math.min(length, size - start))
        const bytes = Buffer.alloc(want)
        const { bytesRead } = want > 0 ? await handle.read(bytes, 0, want, start) : { bytesRead: 0 }
        return { bytes: bytes.subarray(0, bytesRead), size }
      } finally {
        await handle.close()
      }
    }
  }
}

export function remoteTranscriptSource(host: LiveSessionHost, path: string): TranscriptSource {
  return {
    maxRead: 640 * 1024,
    async read(start, length) {
      const f = shQuote(path)
      const out = await host.run(
        `f=${f}; s=$(wc -c < "$f" 2>/dev/null | tr -d ' '); echo "@@SIZE \${s:-0}"; ` +
          `printf '@@BYTES '; tail -c +${start + 1} "$f" 2>/dev/null | head -c ${length} | base64 | tr -d '\\n'; echo`
      )
      const size = Number(/@@SIZE (\d+)/.exec(out)?.[1] ?? 0)
      const b64 = /@@BYTES (\S*)/.exec(out)?.[1] ?? ''
      return { bytes: Buffer.from(b64, 'base64'), size }
    }
  }
}

export function transcriptSourceFor(host: LiveSessionHost, path: string): TranscriptSource {
  return host.machine.kind === 'local'
    ? localTranscriptSource(path)
    : remoteTranscriptSource(host, path)
}

export type TranscriptLine = { offset: number; text: string }

/** Complete lines in `bytes` (which starts at `start`); a trailing partial line is left unread. */
export function completeLines(
  bytes: Buffer,
  start: number,
  dropLeadingPartial: boolean
): { lines: TranscriptLine[]; end: number } {
  const lines: TranscriptLine[] = []
  let at = 0
  if (dropLeadingPartial) {
    const nl = bytes.indexOf(0x0a)
    if (nl === -1) {
      return { lines, end: start }
    }
    at = nl + 1
  }
  for (;;) {
    const nl = bytes.indexOf(0x0a, at)
    if (nl === -1) {
      break
    }
    const text = bytes.subarray(at, nl).toString('utf8')
    if (text.trim()) {
      lines.push({ offset: start + at, text })
    }
    at = nl + 1
  }
  return { lines, end: start + at }
}

export function decodeTranscriptLines(
  provider: LiveSessionProvider,
  lines: TranscriptLine[]
): NativeChatMessage[] {
  const decode = provider === 'claude' ? decodeClaudeTranscriptLine : decodeCodexTranscriptLine
  return lines.flatMap(({ offset, text }) => {
    const kind = classifyLiveTranscriptRecord(provider, text)
    if (kind === 'hidden') {
      return []
    }
    // Offsets are the same in every read of the file, so they key messages across reconnects.
    const id = `o${offset}`
    const decoded = kind === 'summarized' ? summarizedDivider(id, null) : decode(text, id)
    return (decoded ? cleanLiveTranscriptMessage({ ...decoded, id }) : []).map((message) => ({
      ...message,
      transcriptOffset: offset,
      transcriptOrder: offset
    }))
  })
}

const BACK_CHUNK = 256 * 1024
const FORWARD_CHUNK = 512 * 1024

/** Messages before `before` (the file's end when null), newest `limit` of them. */
export async function readTranscriptPage(
  source: TranscriptSource,
  provider: LiveSessionProvider,
  sessionId: string,
  before: number | null,
  limit: number
): Promise<LiveTranscriptPage> {
  const probe = await source.read(0, 0)
  const end = before === null ? probe.size : Math.min(before, probe.size)
  let start = end
  let messages: NativeChatMessage[] = []
  const firstChunk = Math.min(BACK_CHUNK, source.maxRead)
  let chunk = firstChunk
  while (start > 0 && messages.length < limit) {
    const from = Math.max(0, start - chunk)
    const { bytes } = await source.read(from, start - from)
    const { lines } = completeLines(bytes, from, from > 0)
    if (lines.length === 0 && from > 0) {
      // A record bigger than one read is skipped rather than read whole.
      if (chunk >= source.maxRead) {
        start = from
        chunk = firstChunk
      } else {
        chunk = Math.min(chunk * 2, source.maxRead)
      }
      continue
    }
    const firstLine = from > 0 ? lines[0].offset : 0
    messages = [...decodeTranscriptLines(provider, lines), ...messages]
    start = firstLine
    chunk = firstChunk
  }
  if (messages.length > limit) {
    messages = messages.slice(-limit)
    start = messages[0].transcriptOffset ?? start
  }
  return { sessionId, messages, cursor: end, start, more: start > 0 }
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
  cursor: number
): Promise<ForwardRead> {
  let chunk = Math.min(FORWARD_CHUNK, source.maxRead)
  for (;;) {
    const { bytes, size } = await source.read(cursor, chunk)
    if (size < cursor) {
      return { messages: [], lines: [], cursor, size, shrank: true }
    }
    const { lines, end } = completeLines(bytes, cursor, false)
    if (lines.length > 0 || end > cursor || bytes.length < chunk || cursor + bytes.length >= size) {
      return {
        messages: decodeTranscriptLines(provider, lines),
        lines,
        cursor: end,
        size,
        shrank: false
      }
    }
    if (chunk >= source.maxRead) {
      // One enormous record: step past it instead of stalling every reader behind it.
      const next = bytes.indexOf(0x0a)
      return {
        messages: [],
        lines: [],
        cursor: cursor + (next !== -1 ? next + 1 : bytes.length),
        size,
        shrank: false
      }
    }
    chunk = Math.min(chunk * 2, source.maxRead)
  }
}
