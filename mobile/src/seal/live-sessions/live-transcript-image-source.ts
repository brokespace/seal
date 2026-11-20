import {
  parseLiveTranscriptImageUrl,
  readLiveTranscriptImage,
  type LiveTranscriptImageRef
} from '../../../../src/shared/live-sessions/live-transcript-image-ref'
import {
  hostImageReads,
  type MobileNativeChatUrlImageSource
} from '../../session/native-chat/visual/mobile-native-chat-image-preview'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { readLiveTranscriptImagePiece } from './live-session-operations'

/** Data URL characters kept per host: a row drawn again shows its image without reading it again. */
const MAX_KEPT_CHARACTERS = 16 * 1024 * 1024

type Reading = { image: Promise<string | null>; readers: number; stop: AbortController }

class LiveTranscriptImages {
  /** Least recently shown first. */
  private readonly kept = new Map<string, string>()
  private keptCharacters = 0
  private readonly reading = new Map<string, Reading>()

  constructor(private readonly client: RpcClient) {}

  read(sessionId: string, url: string, signal: AbortSignal): Promise<string | null> {
    const ref = parseLiveTranscriptImageUrl(url)
    if (!ref || signal.aborted) {
      return Promise.resolve(null)
    }
    const key = `${sessionId}\0${url}`
    const kept = this.kept.get(key)
    if (kept !== undefined) {
      this.keep(key, kept)
      return Promise.resolve(kept)
    }
    const reading = this.reading.get(key) ?? this.start(key, sessionId, ref)
    reading.readers++
    signal.addEventListener(
      'abort',
      () => {
        reading.readers--
        // No row draws it any more: the pieces still waiting their turn are not read.
        if (reading.readers === 0 && this.reading.get(key) === reading) {
          this.reading.delete(key)
          reading.stop.abort()
        }
      },
      { once: true }
    )
    return reading.image
  }

  private start(key: string, sessionId: string, ref: LiveTranscriptImageRef): Reading {
    const stop = new AbortController()
    const image = readLiveTranscriptImage(ref, async (start, length) => {
      // A piece is a megabyte reply like a host image, so it takes a turn among those.
      const release = await hostImageReads.acquire(0, stop.signal)
      try {
        return await readLiveTranscriptImagePiece(
          this.client,
          { sessionId, start, length },
          stop.signal
        )
      } finally {
        release()
      }
    })
      .then(
        (uri) => {
          this.keep(key, uri)
          return uri
        },
        () => null
      )
      .finally(() => {
        if (this.reading.get(key) === reading) {
          this.reading.delete(key)
        }
      })
    const reading: Reading = { image, readers: 0, stop }
    this.reading.set(key, reading)
    return reading
  }

  private keep(key: string, uri: string): void {
    this.keptCharacters += uri.length - (this.kept.get(key)?.length ?? 0)
    this.kept.delete(key)
    this.kept.set(key, uri)
    for (const [oldest, held] of this.kept) {
      if (this.keptCharacters <= MAX_KEPT_CHARACTERS) {
        break
      }
      this.kept.delete(oldest)
      this.keptCharacters -= held.length
    }
  }
}

// Per client, as the sessions feed is: a host's session ids and transcript offsets mean nothing on another.
const imagesOf = new WeakMap<RpcClient, LiveTranscriptImages>()

/** Reads the images a session's transcript holds inline, which its rows name by `seal-transcript-image:` URL. */
export function liveTranscriptImageSource(
  client: RpcClient,
  sessionId: string
): MobileNativeChatUrlImageSource {
  let images = imagesOf.get(client)
  if (!images) {
    images = new LiveTranscriptImages(client)
    imagesOf.set(client, images)
  }
  const held = images
  return {
    reads: (url) => parseLiveTranscriptImageUrl(url) !== null,
    read: (url, signal) => held.read(sessionId, url, signal)
  }
}
