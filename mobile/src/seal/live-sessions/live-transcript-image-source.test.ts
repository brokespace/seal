import { describe, expect, it } from 'vitest'
import { LiveSessionTranscriptImageParams } from '../../../../src/shared/live-sessions/live-session-rpc-params'
import { stubRpcClient } from '../../transport/rpc/rpc-client-test-stub'
import { liveTranscriptImageSource } from './live-transcript-image-source'

function hostAnswering(base64Of: (length: number) => string) {
  const requests: [string, unknown][] = []
  const client = stubRpcClient({
    sendRequest: (method, params) => {
      requests.push([method, params])
      const base64 = base64Of(LiveSessionTranscriptImageParams.parse(params).length)
      return Promise.resolve({ id: String(requests.length), ok: true, result: { base64 } })
    }
  })
  return { client, requests }
}

const drawn = () => new AbortController().signal

describe('liveTranscriptImageSource', () => {
  it('reads an image once, a megabyte piece at a time, however often its row is drawn', async () => {
    const { client, requests } = hostAnswering((length) => 'A'.repeat(length))
    const source = liveTranscriptImageSource(client, 'session-1')
    const url = 'seal-transcript-image:100+1048580;image/png'
    const image = `data:image/png;base64,${'A'.repeat(1048580)}`

    expect(await Promise.all([source.read(url, drawn()), source.read(url, drawn())])).toEqual([
      image,
      image
    ])
    expect(await liveTranscriptImageSource(client, 'session-1').read(url, drawn())).toBe(image)
    expect(requests).toEqual([
      ['liveSessions.transcriptImage', { sessionId: 'session-1', start: 100, length: 1048576 }],
      ['liveSessions.transcriptImage', { sessionId: 'session-1', start: 1048676, length: 4 }]
    ])
  })

  it('shows an image whose read came back empty once a later read finds it', async () => {
    let held = ''
    const { client } = hostAnswering(() => held)
    const source = liveTranscriptImageSource(client, 'session-1')
    const url = 'seal-transcript-image:100+8;image/png'

    expect(await source.read(url, drawn())).toBeNull()
    held = 'iVBORw0K'
    expect(await source.read(url, drawn())).toBe('data:image/png;base64,iVBORw0K')
  })
})
