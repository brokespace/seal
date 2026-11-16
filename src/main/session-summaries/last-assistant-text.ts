import type { SessionTranscript } from '../live-sessions/transcripts/session-transcript'

const TRANSCRIPT_TAIL_MESSAGES = 30

/** The newest thing the agent itself said: assistant prose, never tool calls, tool output or reasoning. */
export async function lastAssistantText(transcript: SessionTranscript): Promise<string | null> {
  const page = await transcript.page(null, TRANSCRIPT_TAIL_MESSAGES)
  for (let index = page.messages.length - 1; index >= 0; index--) {
    const message = page.messages[index]
    if (message.role !== 'assistant') {
      continue
    }
    const text = message.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    if (text) {
      return text
    }
  }
  return null
}
