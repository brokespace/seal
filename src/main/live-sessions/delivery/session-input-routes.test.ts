import { execFile } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { removeFromOwner } from './session-removal'
import { SessionInputRoutes } from './session-input-routes'

/** A paired server's chat whose ids happen to match a chat and a pane of this Seal's own. */
const SERVER_CHAT: LiveSession = {
  id: 'machine-7:claude:abc',
  provider: 'claude',
  providerSessionId: 'abc',
  machine: { hostId: 'machine-7', label: 'kessel-ml', kind: 'remote', connection: 'server' },
  origin: 'seal',
  ...sampleSessionSurface('seal'),
  surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' },
  cwd: '/srv/app',
  project: 'app',
  title: null,
  status: 'needs-permission',
  statusSource: 'seal-hooks',
  statusDetail: null,
  lastActivityAt: 0,
  startedAt: null,
  alive: true,
  pid: 4321,
  transcriptPath: null,
  inputRoutes: [
    { kind: 'structured', sessionId: 'chat-1' },
    { kind: 'seal-pane', paneKey: 'tab-1:pane-1' }
  ],
  permission: {
    promptId: 'p-1',
    question: 'Run pnpm test?',
    options: [{ id: 'allow', label: 'Allow' }]
  }
}

describe('a paired server session whose server is out of reach', () => {
  it("never reaches this Seal's own chat or pane of the same id", async () => {
    const structured = { send: vi.fn(), answer: vi.fn() }
    const sealPanes = { send: vi.fn(), answer: vi.fn() }
    const stop = vi.fn()
    const routes = new SessionInputRoutes({ host: () => null, structured, sealPanes })
    const signal = new AbortController().signal

    const attempts = await Promise.all(
      SERVER_CHAT.inputRoutes.map((route) =>
        routes.attempt(SERVER_CHAT, route, 'Run the tests', 'r-1', signal)
      )
    )
    const answered = await routes.answer(SERVER_CHAT, {
      sessionId: SERVER_CHAT.id,
      promptId: 'p-1',
      optionId: 'allow'
    })
    const removed = await removeFromOwner(
      SERVER_CHAT,
      { sessionIds: [SERVER_CHAT.id], stop: true, deleteTranscripts: false },
      { server: null, chats: { stop, deleteTranscripts: vi.fn() }, host: null }
    )

    expect(attempts).toEqual([
      { outcome: 'unavailable', reason: 'kessel-ml is not connected' },
      { outcome: 'unavailable', reason: 'kessel-ml is not connected' }
    ])
    expect(answered).toEqual({ ok: false, reason: 'not_answerable' })
    expect(removed).toBe('still_running')
    for (const call of [
      structured.send,
      structured.answer,
      sealPanes.send,
      sealPanes.answer,
      stop
    ]) {
      expect(call).not.toHaveBeenCalled()
    }
  })
})

// Two `claude -p --resume` of one session at once would each append to its transcript.
describe.skipIf(process.platform === 'win32')('a closed session resumed headless', () => {
  it('starts no second resume while the first still runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'seal-resume-'))
    const gate = join(dir, 'turn-over')
    const claude = join(dir, 'claude')
    const ran = join(dir, 'ran')
    await writeFile(
      claude,
      `#!/bin/sh\necho "$4" >> ${ran}\nwhile [ ! -e ${gate} ]; do sleep 0.05; done\n`
    )
    await chmod(claude, 0o755)
    const closed: LiveSession = {
      ...SERVER_CHAT,
      id: 'local:claude:abc',
      machine: { hostId: 'local', label: 'This computer', kind: 'local' },
      surface: { kind: 'external' },
      cwd: null,
      alive: false,
      pid: null,
      inputRoutes: [{ kind: 'resume' }],
      permission: null
    }
    const run = async (script: string) =>
      (
        await promisify(execFile)('sh', ['-c', script], {
          env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }
        })
      ).stdout
    const routes = new SessionInputRoutes({
      host: () => ({ machine: closed.machine, run }),
      sealPanes: null,
      structured: null
    })
    const send = async (text: string) =>
      (await routes.attempt(closed, { kind: 'resume' }, text, 'r-1', new AbortController().signal))
        .outcome
    try {
      expect(await send('first')).toBe('sent')
      expect(await send('second')).toBe('busy')
      await writeFile(gate, '')
      await vi.waitFor(async () => expect(await send('second')).toBe('sent'))
      await vi.waitFor(async () =>
        expect((await readFile(ran, 'utf8')).trim().split('\n')).toEqual(['first', 'second'])
      )
    } finally {
      await writeFile(gate, '')
      await rm(dir, { recursive: true, force: true })
    }
  })
})
