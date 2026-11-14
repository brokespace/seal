import type { LiveMessage, LiveTranscriptMessage } from './live-session-schemas'

const words = (text: string) => text.split(/\s+/).filter(Boolean).join(' ')

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
  const recent = new Map<string, number>()
  for (const m of transcript.slice(-50)) {
    if (m.role === 'user') {
      const text = userText(m)
      recent.set(text, (recent.get(text) ?? 0) + 1)
    }
  }
  const pending: LiveMessage[] = []
  for (const message of [...messages].sort((a, b) => a.createdAt - b.createdAt)) {
    if (message.state === 'delivered') {
      const text = words(message.text)
      const seen = recent.get(text) ?? 0
      if (seen > 0) {
        recent.set(text, seen - 1)
        continue
      }
    }
    pending.push(message)
  }
  return pending
}
