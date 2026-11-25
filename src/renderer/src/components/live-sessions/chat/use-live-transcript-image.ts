import { createContext, useContext, useEffect, useState } from 'react'
import { parseLiveTranscriptImageUrl } from '../../../../../shared/live-sessions/live-transcript-image-ref'
import { leaseLiveTranscriptImage } from './live-transcript-image-cache'

/** The id of the transcript the rows below were read from: a session's, or one of its subagents'. */
export const LiveTranscriptImagesContext = createContext<string | null>(null)

export type LiveTranscriptImage = {
  /** Undefined until it is read, and while it is not `shown`. */
  src: string | undefined
  /** Its bytes could not be read from the transcript. */
  failed: boolean
}

const UNREADABLE: LiveTranscriptImage = { src: undefined, failed: true }

/**
 * An inline image a transcript row names by where it sits in the transcript, read while `shown`.
 * Null when `url` names no such image.
 */
export function useLiveTranscriptImage(
  url: string | undefined,
  shown: boolean
): LiveTranscriptImage | null {
  const transcriptId = useContext(LiveTranscriptImagesContext)
  const named = url !== undefined && parseLiveTranscriptImageUrl(url) !== null
  const key = named && transcriptId ? `${transcriptId}\0${url}` : null
  const [read, setRead] = useState<{ key: string; src: string | null } | null>(null)

  useEffect(() => {
    if (!key || !shown || !transcriptId || !url) {
      return
    }
    const lease = leaseLiveTranscriptImage(transcriptId, url)
    let live = true
    void lease.src.then((src) => {
      if (live) {
        setRead({ key, src })
      }
    })
    return () => {
      live = false
      lease.release()
      // Released, its blob URL may be revoked before it is shown again.
      setRead(null)
    }
  }, [key, shown, transcriptId, url])

  if (!named) {
    return null
  }
  if (!key) {
    return UNREADABLE
  }
  const mine = read?.key === key ? read : null
  return { src: mine?.src ?? undefined, failed: mine?.src === null }
}
