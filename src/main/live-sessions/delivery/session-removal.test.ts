import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { spawnProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { sampleSessionSurface } from '../../../shared/live-sessions/live-session-surface.test-fixture'
import { localHost, type LiveSessionHost } from '../hosts/live-session-hosts'
import { LiveSessionRemovals, removeFromHost, removeSessions } from './session-removal'

const ID = '6a278a68-fb5f-4a43-8007-6af95f274293'

let dir: string
let child: ChildProcess | null

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'seal-remove-')))
  child = null
})

afterEach(async () => {
  child?.kill('SIGKILL')
  await rm(dir, { recursive: true, force: true })
})

function exited(process: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (process.exitCode !== null || process.signalCode !== null) {
      resolve(process.exitCode)
    } else {
      process.once('exit', (code) => resolve(code))
    }
  })
}

function claudeSession(id: string, pid: number, transcriptPath: string | null = null): LiveSession {
  return {
    id: `local:claude:${id}`,
    provider: 'claude',
    providerSessionId: id,
    machine: { hostId: 'local', label: 'mbp', kind: 'local' },
    origin: 'external',
    ...sampleSessionSurface(),
    cwd: dir,
    project: null,
    title: null,
    status: 'working',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: 0,
    startedAt: null,
    alive: true,
    pid,
    transcriptPath,
    inputRoutes: [],
    permission: null
  }
}

describe.skipIf(process.platform === 'win32')('removing a session', () => {
  it('stops the running agent, deletes exactly its transcript files, and stays removed', async () => {
    const binary = join(dir, 'claude')
    await symlink(process.execPath, binary)
    child = spawnProcess({
      program: binary,
      args: ['-e', 'process.stdin.resume()'],
      cwd: dir,
      stdio: ['pipe', 'ignore', 'ignore']
    })
    const projects = join(dir, 'projects')
    await mkdir(join(projects, ID, 'subagents'), { recursive: true })
    await writeFile(join(projects, `${ID}.jsonl`), '{}\n')
    await writeFile(join(projects, 'other.jsonl'), '{}\n')
    const session = claudeSession(ID, child.pid!, join(projects, `${ID}.jsonl`))

    const outcome = await removeFromHost(session, localHost('mbp'), {
      sessionIds: [session.id],
      stop: true,
      deleteTranscripts: true
    })

    expect(outcome).toBe('removed')
    expect(child.signalCode ?? (await exited(child), child.signalCode)).toBe('SIGTERM')
    expect(await readdir(projects)).toEqual(['other.jsonl'])

    const store = join(dir, 'removed.json')
    const removals = new LiveSessionRemovals(store)
    await removals.load()
    removals.add([session.id], 1_800_000_000_000)
    await removals.flush()
    const afterRestart = new LiveSessionRemovals(store)
    await afterRestart.load()
    expect(afterRestart.has(session.id)).toBe(true)
    expect(afterRestart.has('local:claude:someone-else')).toBe(false)
  })

  it('counts an agent that exited but was never reaped as stopped', async () => {
    const binary = join(dir, 'claude')
    await writeFile(binary, '#!/bin/sh\nwhile :; do sleep 1; done\n', { mode: 0o755 })
    // The shell becomes `sleep`, which never waits for the agent it started: killed, it stays a zombie.
    child = spawnProcess({
      program: '/bin/sh',
      args: ['-c', '"$0" & echo $!; exec sleep 300', binary],
      stdio: ['ignore', 'pipe', 'ignore']
    })
    const [printed] = (await once(child.stdout!, 'data')) as [Buffer]
    const session = claudeSession(ID, Number(printed.toString().trim()))

    const outcome = await removeFromHost(session, localHost('mbp'), {
      sessionIds: [session.id],
      stop: true,
      deleteTranscripts: false
    })

    expect(outcome).toBe('removed')
  })

  it('hides the sessions at once, stops them together and lists again the one that kept running', async () => {
    const [quick, slow] = [claudeSession('quick', 4100), claudeSession('slow', 4200)]
    const finish = new Map<number, (output: string) => void>()
    const host: LiveSessionHost = {
      machine: quick.machine,
      run: (script) =>
        new Promise((resolve) => finish.set(Number(/^p=(\d+)$/m.exec(script)![1]), resolve)),
      transcriptFiles: async () => []
    }
    const removals = new LiveSessionRemovals(join(dir, 'removed.json'))
    await removals.load()
    const listed = (): string[] =>
      [quick, slow].filter(({ id }) => !removals.has(id)).map(({ id }) => id)

    const removing = removeSessions(
      { sessionIds: [slow.id, quick.id], stop: true, deleteTranscripts: false },
      {
        session: (id) => [quick, slow].find((session) => session.id === id) ?? null,
        owner: () => ({ server: null, chats: null, host }),
        removals,
        onListChanged: () => {},
        now: () => 1_800_000_000_000
      }
    )
    expect(listed()).toEqual([])

    finish.get(4100)!('@@ALIVE\n@@DONE')
    await vi.waitFor(() => expect(listed()).toEqual(['local:claude:quick']))

    finish.get(4200)!('@@STOPPED\n@@DONE')
    expect((await removing).result).toEqual({
      removed: ['local:claude:slow'],
      failed: [{ sessionId: 'local:claude:quick', reason: 'still_running' }]
    })
    expect(listed()).toEqual(['local:claude:quick'])
  })
})
