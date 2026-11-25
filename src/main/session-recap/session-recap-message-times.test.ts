import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import {
  emptySessionRecap,
  type SessionRecap
} from '../../shared/session-recap/session-recap-types'
import { runLocalScript } from '../live-sessions/hosts/local-shell-script'
import { LiveTranscriptStreams } from '../live-sessions/transcripts/live-transcript-streams'
import { recapMessageTimes, repointMovedRecap } from './session-recap-message-times'
import { recapLiveSession } from './session-recap.test-fixture'

const RECORDINGS = join(__dirname, '..', 'live-sessions', 'transcripts', '__fixtures__')

/** The app's file reader over recordings, each listed as a session of its own. */
function recordings(files: Record<string, string>) {
  const sessions = new Map<string, LiveSession>(
    Object.entries(files).map(([id, file]) => [
      id,
      recapLiveSession({ id, transcriptPath: join(RECORDINGS, file) })
    ])
  )
  const streams = new LiveTranscriptStreams({
    get: (id) => sessions.get(id) ?? null,
    host: () => ({ machine: recapLiveSession().machine, run: runLocalScript })
  })
  return {
    page: (id: string, before: number | null, limit: number) => streams.page(id, before, limit)
  }
}

describe('repointMovedRecap', () => {
  it('points a recap at its messages where a fork holds them', async () => {
    // The fork holds the errored session's history without its metadata lines: every offset differs.
    const transcript = recordings({
      errored: 'claude-2.1.325-error-then-continue.jsonl',
      fork: 'claude-2.1.325-fork-of-errored.jsonl'
    })
    const asked = { id: 'a1', text: 'Try again', messageId: 'o2742', at: 1_000 }
    const request = { ...asked, offset: 2742, status: 'open' as const, statusAt: 1_000 }
    const recap: SessionRecap = {
      ...emptySessionRecap(1_000),
      asked: [asked],
      requests: [request]
    }
    const read = await transcript.page('errored', null, 80)
    const times = recapMessageTimes(undefined, read.messages, recap)

    const moved = await repointMovedRecap(transcript, 'fork', recap, times)

    expect(moved?.recap.asked).toEqual([{ ...asked, messageId: 'o2396' }])
    expect(moved?.recap.requests).toEqual([{ ...request, messageId: 'o2396', offset: 2396 }])
    expect(await repointMovedRecap(transcript, 'errored', recap, times)).toBeNull()
  })
})
