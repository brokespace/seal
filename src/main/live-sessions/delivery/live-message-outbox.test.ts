import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LiveMessage,
  LiveSession,
  LiveSessionInputRoute
} from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { LiveMessageOutbox } from './live-message-outbox'
import type { RouteAttempt } from './session-input-routes'
import type { UserText } from './transcript-user-texts'

const session: LiveSession = {
  id: 'local:claude:abc',
  provider: 'claude',
  providerSessionId: 'abc',
  machine: { hostId: 'local', label: 'mac', kind: 'local' },
  origin: 'external',
  ...sampleSessionSurface(),
  cwd: '/srv/app',
  project: 'app',
  title: null,
  status: 'waiting-input',
  statusSource: 'transcript',
  statusDetail: null,
  lastActivityAt: 1,
  startedAt: 1,
  alive: true,
  pid: 10,
  transcriptPath: '/t.jsonl',
  inputRoutes: [{ kind: 'tmux', target: '%1' }],
  permission: null
}

let dir: string
let clock: number
let transcript: UserText[]
let typed: string[]
let attempt: (route: LiveSessionInputRoute, text: string) => Promise<RouteAttempt>
let current: LiveSession | null
let machineRead: boolean

function outbox(storePath = join(dir, 'outbox.json')) {
  return new LiveMessageOutbox({
    storePath,
    getSession: () => current,
    machineRead: () => machineRead,
    attempt: (_s, route, text) => attempt(route, text),
    transcriptSize: async () => (transcript.at(-1)?.offset ?? 0) + 1,
    userTexts: async (_s, from) => transcript.filter((r) => r.offset >= from),
    onChange: () => {},
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
      await new Promise((resolve) => setImmediate(resolve))
    },
    timing: { confirmEveryMs: 60_000, busyTimeoutMs: 5_000 }
  })
}

async function settle(box: LiveMessageOutbox, until: (m: LiveMessage[]) => boolean) {
  await vi.waitFor(async () => {
    await box.confirm()
    expect(until(box.list())).toBe(true)
  })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'seal-outbox-'))
  clock = 1_000_000
  transcript = [{ offset: 0, text: 'earlier prompt' }]
  typed = []
  current = session
  machineRead = true
  attempt = async (_route, text) => {
    typed.push(text)
    return { outcome: 'sent' }
  }
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('LiveMessageOutbox', () => {
  it('confirms a message only once the transcript shows it, and never types a resend twice', async () => {
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'run the tests' })
    await settle(box, ([m]) => m.state === 'sent')

    expect(
      (await box.send({ sessionId: session.id, messageId: 'm1', text: 'run the tests' })).state
    ).toBe('sent')
    transcript.push({ offset: 500, text: 'run the tests' })
    await settle(box, ([m]) => m.state === 'delivered')
    expect(typed).toEqual(['run the tests'])
    box.stop()
  })

  it('holds the next message until the one ahead reaches the transcript', async () => {
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'first' })
    clock += 1
    await box.send({ sessionId: session.id, messageId: 'm2', text: 'second' })
    await settle(box, ([a]) => a.state === 'sent')
    expect(typed).toEqual(['first'])
    expect(box.list()[1].state).toBe('queued')

    transcript.push({ offset: 500, text: 'first' })
    await settle(box, ([a, b]) => a.state === 'delivered' && b.state === 'sent')
    expect(typed).toEqual(['first', 'second'])
    box.stop()
  })

  it('retries a busy prompt, then fails it after the busy timeout', async () => {
    let busyFor = 2
    attempt = async (_route, text) => {
      if (busyFor-- > 0) {
        return { outcome: 'busy' }
      }
      typed.push(text)
      return { outcome: 'sent' }
    }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'hello' })
    await settle(box, ([m]) => m.state === 'sent')
    expect(typed).toEqual(['hello'])

    attempt = async () => ({ outcome: 'busy' })
    await box.send({ sessionId: session.id, messageId: 'm2', text: 'stuck' })
    transcript.push({ offset: 500, text: 'hello' })
    await settle(box, (all) => all[1].state === 'failed')
    box.stop()
  })

  it('types a message once when its session is renamed while the prompt is busy', async () => {
    let busy = true
    attempt = async (_route, text) => {
      if (busy) {
        return { outcome: 'busy' }
      }
      typed.push(text)
      return { outcome: 'sent' }
    }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'hello' })
    await vi.waitFor(() => expect(box.list()[0].state).toBe('queued'))
    box.renameSession(session.id, 'local:claude:real-id')
    busy = false
    await settle(box, ([m]) => m.state === 'sent')
    for (let turn = 0; turn < 20; turn++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(typed).toEqual(['hello'])
    expect(box.list()[0].sessionId).toBe('local:claude:real-id')
    box.stop()
  })

  it('fails a sent message when the session closes without reading it', async () => {
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'hello' })
    await settle(box, ([m]) => m.state === 'sent')
    current = { ...session, alive: false }
    clock += 10_000
    await settle(box, ([m]) => m.state === 'failed')
    expect(box.list()[0].unconfirmed).toBe(true)
    box.stop()
  })

  it('after a restart, waits on the transcript for a message it was typing instead of retyping it', async () => {
    const storePath = join(dir, 'outbox.json')
    await writeFile(
      storePath,
      JSON.stringify([
        {
          messageId: 'm1',
          sessionId: session.id,
          text: 'half typed',
          state: 'sending',
          route: 'tmux',
          error: null,
          createdAt: 1,
          updatedAt: 1,
          offset: 100,
          sentAt: clock
        }
      ])
    )
    const box = outbox(storePath)
    await box.start()
    expect(box.list()[0].state).toBe('sent')
    transcript.push({ offset: 200, text: 'half typed' })
    await settle(box, ([m]) => m.state === 'delivered')
    expect(typed).toEqual([])
    await box.flush()
    expect(JSON.parse(await readFile(storePath, 'utf8'))[0].state).toBe('delivered')
    box.stop()
  })

  // Seal restarted: its outbox looks before the first scan of the session's machine has ended.
  it('does not call a session closed while its machine has not been read', async () => {
    current = { ...session, status: 'working' }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'hello' })
    await settle(box, ([m]) => m.state === 'sent')
    current = null
    machineRead = false
    clock += 60_000
    await box.confirm()
    expect(box.list()[0].state).toBe('sent')

    machineRead = true
    await settle(box, ([m]) => m.state === 'failed')
    expect(box.list()[0].unconfirmed).toBe(true)
    box.stop()
  })

  it('stops waiting for a machine that is never read once the order hold is over', async () => {
    current = { ...session, status: 'working' }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'hello' })
    await settle(box, ([m]) => m.state === 'sent')
    current = null
    machineRead = false
    clock += 16 * 60_000
    await settle(box, ([m]) => m.state === 'failed')
    box.stop()
  })

  // The CLI took the keys but never ran them: a menu was open, or it kept them as a draft.
  it('gives up on a typed message its session never shows once the agent is at its prompt, and types the next', async () => {
    current = { ...session, status: 'working' }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'first' })
    clock += 1
    await box.send({ sessionId: session.id, messageId: 'm2', text: 'second' })
    await settle(box, ([a]) => a.state === 'sent')
    // A working agent keeps what is typed in its own queue: nothing says it was lost.
    clock += 300_000
    await box.confirm()
    expect(box.list().map((m) => m.state)).toEqual(['sent', 'queued'])

    current = { ...session, status: 'your-turn' }
    await box.confirm()
    clock += 91_000
    await settle(box, ([a, b]) => a.state === 'failed' && b.state === 'sent')
    expect(typed).toEqual(['first', 'second'])

    // The agent ran it after all: its transcript says so.
    transcript.push({ offset: 500, text: 'first' })
    await settle(box, ([a]) => a.state === 'delivered')
    box.stop()
  })

  // A headless resume wrote the message after Seal stopped waiting for it.
  it('confirms a resumed message its transcript shows only after it was given up as unconfirmed', async () => {
    current = { ...session, alive: false, pid: null, inputRoutes: [{ kind: 'resume' }] }
    const box = outbox()
    await box.send({ sessionId: session.id, messageId: 'm1', text: 'first' })
    await settle(box, ([m]) => m.state === 'sent')
    clock += 91_000
    await settle(box, ([m]) => m.state === 'failed')
    expect(box.list()[0].unconfirmed).toBe(true)

    transcript.push({ offset: 500, text: 'first' })
    await box.send({ sessionId: session.id, messageId: 'm2', text: 'second' })
    await settle(box, ([a, b]) => a.state === 'delivered' && b.state === 'sent')
    expect(box.list()[0].unconfirmed).toBeUndefined()
    expect(typed).toEqual(['first', 'second'])
    box.stop()
  })

  // The agent may have run it without a sign: typing it again could run it twice.
  it('types a message that timed out unconfirmed again only once the retry says it may run twice', async () => {
    const storePath = join(dir, 'outbox.json')
    current = { ...session, status: 'your-turn' }
    const first = outbox(storePath)
    await first.send({ sessionId: session.id, messageId: 'm1', text: 'drop the table' })
    await settle(first, ([m]) => m.state === 'sent')
    await first.confirm()
    clock += 91_000
    await settle(first, ([m]) => m.state === 'failed')
    expect(first.list()[0].unconfirmed).toBe(true)
    await first.flush()
    first.stop()

    const box = outbox(storePath)
    expect(await box.retry('m1')).toMatchObject({ state: 'failed', unconfirmed: true })
    for (let turn = 0; turn < 20; turn++) {
      await new Promise((resolve) => setImmediate(resolve))
    }
    expect(typed).toEqual(['drop the table'])

    await box.retry('m1', true)
    await settle(box, ([m]) => m.state === 'sent')
    expect(typed).toEqual(['drop the table', 'drop the table'])
    expect(box.list()[0].unconfirmed).toBeUndefined()
    box.stop()
  })

  // Its session is on a paired server, which sends what goes to it.
  it('keeps a message the server did not take on disk, as failed, until the server has it', async () => {
    const request = { sessionId: session.id, messageId: 'm1', text: 'deploy it' }
    const box = outbox()
    await box.offer(request, async () => ({ refused: 'The server did not answer' }))
    await box.flush()
    box.stop()

    const restarted = outbox()
    await restarted.start()
    expect(restarted.list().map((m) => [m.messageId, m.text, m.state, m.error])).toEqual([
      ['m1', 'deploy it', 'failed', 'The server did not answer']
    ])

    const onServer: LiveMessage = { ...restarted.list()[0], state: 'queued', error: null }
    expect(await restarted.offer(request, async () => onServer)).toEqual(onServer)
    await restarted.flush()
    expect(JSON.parse(await readFile(join(dir, 'outbox.json'), 'utf8'))).toEqual([])
    expect(typed).toEqual([])
    restarted.stop()
  })
})
