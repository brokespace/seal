import type { HomeChatEntry } from '../../shared/home-chat/home-chat-types'

const MAX_PREAMBLE_CHARS = 12_000

/** Earlier turns, for a fresh backend session that never saw them (after a backend or account switch). */
export function withTranscriptPreamble(entries: readonly HomeChatEntry[], message: string): string {
  const lines = entries.flatMap((entry) => {
    if (entry.kind === 'user') {
      return [`User: ${entry.text}`]
    }
    if (entry.kind === 'assistant' && entry.text.trim()) {
      return [`Assistant: ${entry.text}`]
    }
    if (entry.kind === 'tool' && entry.status !== 'awaiting-approval') {
      return [`(tool ${entry.tool} ${entry.status}${entry.machine ? ` on ${entry.machine}` : ''})`]
    }
    return []
  })
  if (lines.length === 0) {
    return message
  }
  let transcript = lines.join('\n')
  if (transcript.length > MAX_PREAMBLE_CHARS) {
    transcript = `…${transcript.slice(-MAX_PREAMBLE_CHARS)}`
  }
  return `<earlier_conversation>\n${transcript}\n</earlier_conversation>\n\n${message}`
}
