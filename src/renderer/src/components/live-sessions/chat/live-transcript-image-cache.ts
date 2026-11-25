import { decodeBase64Bytes } from '@/lib/base64-bytes'
import { parseLiveTranscriptImageUrl } from '../../../../../shared/live-sessions/live-transcript-image-ref'

/** What is kept of images no row shows, oldest dropped first; one a row shows is never dropped. */
const MAX_IMAGES = 64
const MAX_BYTES = 64 * 1024 * 1024

type HeldImage = {
  /** A blob URL, or null when the transcript's bytes could not be read. */
  src: Promise<string | null>
  bytes: number
  leases: number
}

const held = new Map<string, HeldImage>()

export type LiveTranscriptImageLease = {
  src: Promise<string | null>
  /** Its blob URL stays valid until every lease on the image is released. */
  release: () => void
}

function trim(): void {
  let bytes = 0
  for (const image of held.values()) {
    bytes += image.bytes
  }
  for (const [key, image] of held) {
    if (held.size <= MAX_IMAGES && bytes <= MAX_BYTES) {
      return
    }
    if (image.leases === 0) {
      held.delete(key)
      bytes -= image.bytes
      void image.src.then((src) => src && URL.revokeObjectURL(src))
    }
  }
}

async function readBlob(
  transcriptId: string,
  url: string
): Promise<{ src: string; bytes: number } | null> {
  const ref = parseLiveTranscriptImageUrl(url)
  if (!ref) {
    return null
  }
  try {
    const dataUrl = await window.api.liveSessions.transcriptImage({ sessionId: transcriptId, url })
    if (!dataUrl) {
      return null
    }
    const bytes = decodeBase64Bytes(dataUrl.slice(dataUrl.indexOf(',') + 1))
    return {
      src: URL.createObjectURL(new Blob([bytes], { type: ref.mimeType })),
      bytes: bytes.byteLength
    }
  } catch {
    return null
  }
}

function read(key: string, transcriptId: string, url: string): HeldImage {
  const image: HeldImage = {
    bytes: 0,
    leases: 0,
    src: readBlob(transcriptId, url).then((blob) => {
      if (!blob) {
        // Not kept: the next row to show it reads again, when its machine may answer.
        if (held.get(key) === image) {
          held.delete(key)
        }
        return null
      }
      image.bytes = blob.bytes
      trim()
      return blob.src
    })
  }
  return image
}

/**
 * One inline image of a transcript (`seal-transcript-image:` url), by the id of the transcript
 * whose row names it. Read once however many rows ask, and kept for the next row that does.
 */
export function leaseLiveTranscriptImage(
  transcriptId: string,
  url: string
): LiveTranscriptImageLease {
  const key = `${transcriptId}\0${url}`
  const image = held.get(key) ?? read(key, transcriptId, url)
  // Asked for last, dropped last.
  held.delete(key)
  held.set(key, image)
  image.leases++
  let released = false
  return {
    src: image.src,
    release: () => {
      if (!released) {
        released = true
        image.leases--
        trim()
      }
    }
  }
}
