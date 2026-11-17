// An image a transcript record holds inline. History names it by where its base64 sits in the
// transcript file; whoever shows it reads those bytes with `liveSessions.transcriptImage`.

export type LiveTranscriptImageRef = {
  mimeType: string
  /** Byte offset of the base64 in the transcript file. */
  start: number
  /** Its length in bytes, padding included. */
  length: number
}

const SCHEME = 'seal-transcript-image:'
const URL = /^seal-transcript-image:(\d+)\+(\d+);(image\/[a-z0-9.+-]+)$/

/** Base64 one `transcriptImage` call returns at most: a whole number of 4-character groups under every reply cap. */
export const LIVE_TRANSCRIPT_IMAGE_PIECE_BYTES = 1024 * 1024
const MAX_IMAGE_BYTES = 32 * LIVE_TRANSCRIPT_IMAGE_PIECE_BYTES

export function liveTranscriptImageUrl(ref: LiveTranscriptImageRef): string {
  return `${SCHEME}${ref.start}+${ref.length};${ref.mimeType}`
}

export function parseLiveTranscriptImageUrl(url: string): LiveTranscriptImageRef | null {
  const match = URL.exec(url)
  if (!match) {
    return null
  }
  const start = Number(match[1])
  const length = Number(match[2])
  return Number.isSafeInteger(start) && length > 0 && length <= MAX_IMAGE_BYTES
    ? { mimeType: match[3], start, length }
    : null
}

/** The image as a data URL, read a piece at a time through `read`. */
export async function readLiveTranscriptImage(
  ref: LiveTranscriptImageRef,
  read: (start: number, length: number) => Promise<string>
): Promise<string> {
  const pieces: Promise<string>[] = []
  for (let at = 0; at < ref.length; at += LIVE_TRANSCRIPT_IMAGE_PIECE_BYTES) {
    pieces.push(read(ref.start + at, Math.min(LIVE_TRANSCRIPT_IMAGE_PIECE_BYTES, ref.length - at)))
  }
  const base64 = (await Promise.all(pieces)).join('')
  if (base64.length !== ref.length) {
    throw new Error('The transcript no longer holds this image')
  }
  return `data:${ref.mimeType};base64,${base64}`
}
