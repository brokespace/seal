import type { LiveSessionProvider } from '../../../shared/live-sessions/live-session-types'
import type { TranscriptLine } from '../transcripts/live-transcript-reader'
import {
  isJsonRecord,
  parseJsonRecord,
  recordField
} from '../../../shared/live-sessions/transcript-json-record'
import { timesSaid } from '../../../shared/live-sessions/live-session-pending-messages'
import { codexUserMessageText } from '../discovery/codex-user-message'

export type UserText = { offset: number; text: string }

/** Keep what can be typed: text, new lines and tabs. Escapes and controls would end a paste early. */
export function sanitizeTypedText(text: string): string {
  let out = ''
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    const c = ch.codePointAt(0)!
    if (ch === '\n' || ch === '\t' || (c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0))) {
      out += ch
    }
  }
  return out.trim()
}

export function normalizeForMatch(text: string): string {
  return sanitizeTypedText(text).split(/\s+/).filter(Boolean).join(' ')
}

function contentText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((block) => {
      if (typeof block === 'string') {
        return block
      }
      return isJsonRecord(block) && block.type === 'text' && typeof block.text === 'string'
        ? block.text
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * What the transcript records the user saying, typed or queued. Claude Code writes a message
 * typed while it works as a `queued_command` attachment and joins several into one record.
 */
export function userTextsOf(provider: LiveSessionProvider, lines: TranscriptLine[]): UserText[] {
  const out: UserText[] = []
  for (const { offset, text } of lines) {
    if (!/user|UserMessage|attachment/.test(text)) {
      continue
    }
    const record = parseJsonRecord(text)
    if (!record) {
      continue
    }
    let said = ''
    if (provider === 'claude') {
      const attachment = recordField(record, 'attachment')
      if (record.type === 'user') {
        said = contentText(recordField(record, 'message')?.content)
      } else if (record.type === 'attachment' && attachment?.type === 'queued_command') {
        said = contentText(attachment.prompt)
      }
    } else {
      said = codexUserMessageText(record) ?? ''
    }
    if (said.trim()) {
      out.push({ offset, text: normalizeForMatch(said) })
    }
  }
  return out
}

/**
 * Pair each pending message, oldest first, with a user record at or after where it went in.
 * Each delivered message comes with the offset of the record that holds it.
 */
export function matchDelivered<T extends { text: string; offset: number }>(
  pending: T[],
  records: UserText[]
): Map<T, number> {
  const used = new Map<string, number>()
  const delivered = new Map<T, number>()
  for (const item of pending) {
    const want = normalizeForMatch(item.text)
    if (!want) {
      continue
    }
    for (let i = 0; i < records.length; i++) {
      const record = records[i]
      if (record.offset < item.offset) {
        continue
      }
      // Word-bounded: queued messages arrive joined in one record, but "ok" must not match "look".
      const key = `${i}\n${want}`
      if (timesSaid(record.text, want) > (used.get(key) ?? 0)) {
        used.set(key, (used.get(key) ?? 0) + 1)
        delivered.set(item, record.offset)
        break
      }
    }
  }
  return delivered
}
