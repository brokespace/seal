import { mkdir, mkdtemp, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import type { ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import { localHost } from '../hosts/live-session-hosts'
import { LiveSessionRemovals, removeFromHost } from './session-removal'

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
    const session: LiveSession = {
      id: `local:claude:${ID}`,
      provider: 'claude',
      providerSessionId: ID,
      machine: { hostId: 'local', label: 'mbp', kind: 'local' },
      origin: 'external',
      cwd: dir,
      project: null,
      title: null,
      status: 'working',
      statusSource: 'transcript',
      statusDetail: null,
      lastActivityAt: 0,
      startedAt: null,
      alive: true,
      pid: child.pid!,
      transcriptPath: join(projects, `${ID}.jsonl`),
      inputRoutes: [],
      permission: null
    }

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
})
