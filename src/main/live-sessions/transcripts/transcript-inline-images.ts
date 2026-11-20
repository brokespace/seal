import {
  parseLiveTranscriptImageUrl,
  readLiveTranscriptImage
} from '../../../shared/live-sessions/live-transcript-image-ref'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'

/**
 * Rows for a client that predates image references: each referenced image goes back into its row
 * as the data URL such a client shows. An image that can't be read keeps its reference.
 */
export async function withInlineImages(
  messages: NativeChatMessage[],
  read: (start: number, length: number) => Promise<string>
): Promise<NativeChatMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!message.blocks.some((block) => block.type === 'image-ref' && referenceOf(block.url))) {
        return message
      }
      const blocks = await Promise.all(
        message.blocks.map(async (block) => {
          const ref = block.type === 'image-ref' ? referenceOf(block.url) : null
          if (block.type !== 'image-ref' || !ref) {
            return block
          }
          const url = await readLiveTranscriptImage(ref, read).catch(() => null)
          return url ? { ...block, url } : block
        })
      )
      return { ...message, blocks }
    })
  )
}

const referenceOf = (url: string | undefined) => (url ? parseLiveTranscriptImageUrl(url) : null)
