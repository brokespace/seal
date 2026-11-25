import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  LiveSession,
  LiveTranscriptDelta
} from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { localHost } from '../hosts/live-session-hosts'
import { LiveTranscriptStreams } from './live-transcript-streams'

const user = (text: string) =>
  JSON.stringify({ type: 'user', uuid: text, message: { role: 'user', content: text } })

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seal-watch-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function sessionAt(transcriptPath: string): LiveSession {
  return {
    id: 'local:claude:abc',
    provider: 'claude',
    providerSessionId: 'abc',
    machine: localHost('test').machine,
    origin: 'seal',
    ...sampleSessionSurface('seal'),
    cwd: '/repo',
    project: 'repo',
    title: 'Fix login',
    status: 'working',
    statusSource: 'seal-hooks',
    statusDetail: null,
    lastActivityAt: 1_000,
    startedAt: 500,
    alive: true,
    pid: 42,
    transcriptPath,
    inputRoutes: [],
    permission: null
  }
}

describe('watching a session transcript', () => {
  it('answers an empty page for a file not written yet and delivers once it is', async () => {
    const host = localHost('test')
    const transcriptPath = join(dir, 'not-yet.jsonl')
    const session = sessionAt(transcriptPath)
    const streams = new LiveTranscriptStreams(
      { get: () => session, host: () => host },
      { pollMs: { local: 5, ssh: 5 } }
    )
    let deliver: (delta: LiveTranscriptDelta) => void = () => undefined
    const delivered = new Promise<LiveTranscriptDelta>((resolve) => (deliver = resolve))
    const watch = streams.subscribe(session.id, null, (delta) => deliver(delta))
    try {
      expect(await watch.ready).toEqual({
        sessionId: 'local:claude:abc',
        messages: [],
        cursor: 0,
        start: 0,
        more: false
      })

      await writeFile(transcriptPath, `${user('hello')}\n`)

      const delta = await delivered
      expect(delta.from).toBe(0)
      expect(delta.messages.map((m) => m.blocks[0])).toEqual([{ type: 'text', text: 'hello' }])
    } finally {
      watch.unsubscribe()
    }
  })

  it('gives a watcher far behind the newest page at once, not the history in between', async () => {
    const host = localHost('test')
    const transcriptPath = join(dir, 'long.jsonl')
    const session = sessionAt(transcriptPath)
    const text = `${Array.from({ length: 400 }, (_, i) => user(`m${i}`)).join('\n')}\n`
    await writeFile(transcriptPath, text)
    const streams = new LiveTranscriptStreams(
      { get: () => session, host: () => host },
      { pollMs: { local: 5, ssh: 5 } }
    )
    let deliver: (delta: LiveTranscriptDelta) => void = () => undefined
    const delivered = new Promise<LiveTranscriptDelta>((resolve) => (deliver = resolve))
    const watch = streams.subscribe(session.id, 0, (delta) => deliver(delta))
    try {
      const delta = await delivered
      expect(delta.reset).toBe(true)
      expect(delta.cursor).toBe(text.length)
      expect(delta.messages.map((m) => m.blocks[0])).toEqual(
        Array.from({ length: 80 }, (_, i) => ({ type: 'text', text: `m${320 + i}` }))
      )
    } finally {
      watch.unsubscribe()
    }
  })
})
