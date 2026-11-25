import { describe, expect, it } from 'vitest'
import type { NativeChatMessage } from '../../../shared/native-chat/native-chat-types'
import { withInlineImages } from './transcript-inline-images'

describe('rows for a client that predates image references', () => {
  it('carry each referenced image as a data URL', async () => {
    const file = 'xxxxxiVBORw0KGgoyyyyy'
    const row: NativeChatMessage = {
      id: 'o0',
      role: 'user',
      timestamp: null,
      source: 'transcript',
      blocks: [
        { type: 'text', text: 'look' },
        { type: 'image-ref', url: 'seal-transcript-image:5+12;image/png' },
        { type: 'image-ref', path: '/tmp/shot.png' }
      ]
    }
    const [inlined] = await withInlineImages([row], async (start, length) =>
      file.slice(start, start + length)
    )
    expect(inlined.blocks).toEqual([
      { type: 'text', text: 'look' },
      { type: 'image-ref', url: 'data:image/png;base64,iVBORw0KGgoy' },
      { type: 'image-ref', path: '/tmp/shot.png' }
    ])
  })
})
