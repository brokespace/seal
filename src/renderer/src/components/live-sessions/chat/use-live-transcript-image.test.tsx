// @vitest-environment happy-dom
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NativeChatImageAttachments } from '../../native-chat/media/images/NativeChatImageAttachments'
import { LiveTranscriptImagesContext } from './use-live-transcript-image'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('draws an image a row names by reference from the bytes of the transcript that holds the row', async () => {
  // Without an observer every image counts as in view.
  vi.stubGlobal('IntersectionObserver', undefined)
  const blobs: Blob[] = []
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    if (blob instanceof Blob) {
      blobs.push(blob)
    }
    return 'blob:transcript-image'
  })
  const subagentTranscript = 'gpu-box:claude:abc#subagent:a1'
  const url = 'seal-transcript-image:120+8;image/png'
  vi.stubGlobal('api', {
    liveSessions: {
      transcriptImage: async (args: { sessionId: string; url: string }) =>
        args.sessionId === subagentTranscript && args.url === url
          ? 'data:image/png;base64,iVBORw=='
          : null
    }
  })

  const { container } = render(
    <LiveTranscriptImagesContext value={subagentTranscript}>
      <NativeChatImageAttachments blocks={[{ type: 'image-ref', url }]} runtimeContext={null} />
    </LiveTranscriptImagesContext>
  )

  await waitFor(() =>
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:transcript-image')
  )
  expect(blobs.map((blob) => blob.type)).toEqual(['image/png'])
  expect([...new Uint8Array(await blobs[0].arrayBuffer())]).toEqual([0x89, 0x50, 0x4e, 0x47])
})
