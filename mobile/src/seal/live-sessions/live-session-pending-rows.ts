import type { LiveMessage, LiveTranscriptMessage } from './live-session-schemas'

// Two spaces between words: counting a text inside a row must not share a space between two finds.
const words = (text: string) => ` ${text.split(/\s+/).filter(Boolean).join('  ')} `

function userText(message: LiveTranscriptMessage): string {
  return words(
    message.blocks.map((block) => (block.type === 'text' ? (block.text ?? '') : '')).join('\n')
  )
}

/**
 * Outbox messages the transcript doesn't show yet, oldest first. A delivered message stays until its
 * transcript row arrives (the transcript is read a moment after delivery is seen).
 */
export function pendingLiveMessages(
  transcript: readonly LiveTranscriptMessage[],
  messages: readonly LiveMessage[]
): LiveMessage[] {
  const said: string[] = []
  let newest = 0
  for (const m of transcript) {
    newest = Math.max(newest, m.timestamp ?? 0)
    if (m.role === 'user') {
      said.push(userText(m))
    }
  }
  const taken = new Map<string, number>()
  // Why inside a row: the agent writes messages typed while it works into one record.
  const shown = (text: string): boolean =>
    said.some((row, at) => {
      const key = `${at}\n${text}`
      const used = taken.get(key) ?? 0
      const found = row.split(text).length - 1 > used
      if (found) {
        taken.set(key, used + 1)
      }
      return found
    })
  const pending: LiveMessage[] = []
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    // Why the time: a transcript written past the delivery holds the row, shown or scrolled out of what is loaded.
    if (
      message.state === 'delivered' &&
      (message.updatedAt < newest || shown(words(message.text)))
    ) {
      continue
    }
    pending.push(message)
  }
  return pending
}
