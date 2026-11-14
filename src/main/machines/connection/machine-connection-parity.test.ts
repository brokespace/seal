import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { MachineView } from '../../../shared/machines/machine-view'
import { createUnifiedMachine } from '../../home-chat/machines/home-chat-unified-machine'
import { machineLiveSessionHost } from '../../live-sessions/hosts/live-session-hosts'
import { runtimeLiveSessionHost } from '../../live-sessions/hosts/runtime-live-session-host'
import type { MachineSummary } from '../../../shared/machines/machine-summaries'
import { installLoginOnMachine } from '../../seal-accounts/seal-machine-login-install'
import {
  createInProcessRuntimeChannel,
  createLoopbackSshLink
} from '../testing/machine-transport-test-doubles'
import {
  createMachineWorktree,
  listMachineWorktrees,
  removeMachineWorktree
} from '../work/machine-worktrees'
import { runLocalShellScript } from '../exec/local-shell-exec'
import { classifyMachineWorktreeRemovalRefusal } from '../../../shared/machines/machine-worktree-removal-refusal'
import { openLocalPty } from './local-machine-shell'
import type { MachineConnection } from './machine-connection'
import { ServerMachineConnection } from './server-machine-connection'
import { SshMachineConnection } from './ssh-machine-connection'

// Both transports reach this host, so one expectation must hold for each of them.
let home = ''
const saved = { HOME: process.env.HOME, SHELL: process.env.SHELL }

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-parity-home-')))
  process.env.HOME = home
  process.env.SHELL = '/bin/sh'
})

afterAll(async () => {
  process.env.HOME = saved.HOME
  process.env.SHELL = saved.SHELL
  await rm(home, { recursive: true, force: true })
})

function sshConnection(): MachineConnection {
  const link = createLoopbackSshLink()
  return new SshMachineConnection('machine:loop-ssh', {
    link: () => link,
    connect: async () => {},
    // Mirrors system ssh: `ssh -t` lands in a login shell, then the prelude is typed into it.
    openSystemShell: async (prelude, options, handlers) => {
      const shell = await openLocalPty({ file: '/bin/sh', args: [], cwd: home }, options, handlers)
      if (prelude) {
        shell.write(`${prelude}\n`)
      }
      return shell
    }
  })
}

const server = createInProcessRuntimeChannel().channel

function serverConnection(): MachineConnection {
  return new ServerMachineConnection('machine:loop-server', {
    channel: server,
    isConnected: () => true,
    connect: async () => {}
  })
}

// What the desktop wires in for server machines: the server's own `liveSessions.hostRun`.
const serverScan = runtimeLiveSessionHost({ id: 'loop', label: 'loop' }, async (...call) => ({
  id: '1',
  ok: true,
  result: await server.call(call[1], call[2], call[3]),
  _meta: { runtimeId: 'loop' }
})).run

function viewFor(connection: MachineConnection): MachineView {
  return {
    id: connection.machineId,
    recordId: 'loop',
    name: 'loop',
    connection: connection.transport === 'server' ? 'server' : 'ssh',
    ssh: null,
    server: null
  }
}

function summaryFor(connection: MachineConnection): MachineSummary {
  return {
    id: connection.machineId,
    connection: connection.transport === 'server' ? 'server' : 'ssh',
    label: 'loop',
    address: null,
    status: 'online',
    statusDetail: null,
    os: 'linux',
    sshTargetId: null,
    runtimeEnvironmentId: null,
    executionHostId: connection.transport === 'server' ? 'runtime:loop' : 'ssh:loop'
  }
}

async function scratch(): Promise<string> {
  return realpath(await mkdtemp(path.join(home, 'work-')))
}

describe.skipIf(process.platform !== 'linux').each([
  ['SSH', sshConnection],
  ['Seal server', serverConnection]
])('a machine connected via %s', (_name, connect) => {
  const machine = connect()

  it('runs commands with stdin, folder and exit status', async () => {
    const dir = await scratch()
    const echoed = await machine.exec('cat; pwd', {
      timeoutMs: 15_000,
      stdin: 'payload\n',
      cwd: dir
    })
    const failed = await machine.exec('echo oops >&2; exit 3', { timeoutMs: 15_000 })

    expect(echoed).toMatchObject({ exitCode: 0, stdout: `payload\n${dir}\n`, timedOut: false })
    expect(failed).toMatchObject({ exitCode: 3, stderr: 'oops\n' })
    expect(await machine.dialect()).toBe('posix')
  })

  it('reports who the host is and how it is doing', async () => {
    const identity = await machine.identity()
    const metrics = await machine.metrics()

    expect(identity.hostname?.toLowerCase()).toBe(os.hostname().toLowerCase())
    expect(metrics.os).toBe('linux')
    expect(metrics.homeDir).toBe(home)
    expect(metrics.memTotalBytes).toBeGreaterThan(0)
  })

  it('edits, previews, renames and deletes files', async () => {
    const dir = await scratch()
    const file = path.join(dir, 'notes.txt')
    await machine.files.writeFile(file, Buffer.from('hello world'))
    await machine.files.createDir(path.join(dir, 'sub'))
    await machine.files.rename(file, path.join(dir, 'sub', 'moved.txt'))

    const preview = await machine.files.readFile(path.join(dir, 'sub', 'moved.txt'), 5)
    const listing = (await machine.files.listDir(dir)).map((entry) => [entry.name, entry.kind])
    await machine.files.remove(path.join(dir, 'sub'))

    expect(preview).toEqual({ size: 11, data: Buffer.from('hello') })
    expect(listing).toEqual([['sub', 'directory']])
    expect(await machine.files.listDir(dir)).toEqual([])
    expect(await machine.files.homeDir()).toBe(home)
  })

  it('uploads and downloads byte-for-byte with full progress', async () => {
    const dir = await scratch()
    const payload = randomBytes(300_000)
    await writeFile(path.join(dir, 'local.bin'), payload)
    const session = await machine.files.openTransferSession(new AbortController().signal)
    let progress = 0
    await session.uploadFile(
      path.join(dir, 'local.bin'),
      path.join(dir, 'up', 'remote.bin'),
      300_000,
      (d) => {
        progress += d
      }
    )
    await session.downloadFile(
      path.join(dir, 'up', 'remote.bin'),
      path.join(dir, 'back.bin'),
      300_000,
      (d) => {
        progress += d
      }
    )
    session.close()

    expect((await readFile(path.join(dir, 'back.bin'))).equals(payload)).toBe(true)
    expect(progress).toBe(600_000)
  })

  // An SSH host without inotifywait is polled every 3s, so a change can take a few ticks to land.
  it('tells a watcher when a folder changes', { timeout: 15_000 }, async () => {
    const dir = await scratch()
    const seen: string[] = []
    const stop = await machine.files.watch([dir], (changed) => seen.push(changed))
    try {
      await vi.waitFor(
        async () => {
          await writeFile(path.join(dir, `touch-${seen.length}.txt`), 'x')
          expect(seen).toContain(dir)
        },
        { timeout: 12_000, interval: 500 }
      )
    } finally {
      stop?.()
    }
  })

  // A real PTY starting a login shell is slow on loaded CI machines.
  it('runs a command in a terminal and reports its exit', { timeout: 20_000 }, async () => {
    let output = ''
    const exited = new Promise<number | null>((resolve) => {
      void machine.openShell(
        { cols: 80, rows: 24, cwd: home, command: 'echo parity-$((40+2))' },
        { onData: (data) => (output += data), onExit: resolve }
      )
    })

    await exited
    expect(output).toContain('parity-42')
  })

  it('creates, lists and removes worktrees', async () => {
    const repo = await scratch()
    const git = `git -c user.email=seal@example.com -c user.name=Seal`
    await runLocalShellScript(`git init -q -b main && ${git} commit -q --allow-empty -m init`, {
      timeoutMs: 15_000,
      cwd: repo
    })
    const worktree = path.join(path.dirname(repo), `${path.basename(repo)}-feature`)

    const created = await createMachineWorktree(machine, {
      repoPath: repo,
      path: worktree,
      branch: 'feature'
    })
    const removed = await removeMachineWorktree(machine, { repoPath: repo, path: worktree })

    expect(created.map((entry) => [entry.path, entry.branch])).toEqual([
      [repo, 'main'],
      [worktree, 'feature']
    ])
    expect(removed.map((entry) => entry.path)).toEqual([repo])
    expect(await listMachineWorktrees(machine, repo)).toEqual(removed)
  })

  it('removes dirty and locked worktrees only with the matching waiver', async () => {
    const repo = await scratch()
    const git = `git -c user.email=seal@example.com -c user.name=Seal`
    await runLocalShellScript(`git init -q -b main && ${git} commit -q --allow-empty -m init`, {
      timeoutMs: 15_000,
      cwd: repo
    })
    const at = (name: string): string =>
      path.join(path.dirname(repo), `${path.basename(repo)}-${name}`)
    for (const name of ['dirty', 'locked', 'gone']) {
      await createMachineWorktree(machine, { repoPath: repo, path: at(name), branch: name })
    }
    await writeFile(path.join(at('dirty'), 'scratch.txt'), 'uncommitted')
    await runLocalShellScript(`git worktree lock --reason 'agent running' '${at('locked')}'`, {
      timeoutMs: 15_000,
      cwd: repo
    })
    await rm(at('gone'), { recursive: true, force: true })
    const refusal = async (args: { path: string; force?: boolean }): Promise<unknown> =>
      classifyMachineWorktreeRemovalRefusal(
        await removeMachineWorktree(machine, { repoPath: repo, ...args }).then(
          () => 'removed',
          (error: Error) => error.message
        )
      )

    expect(await refusal({ path: at('dirty') })).toEqual({ kind: 'changes' })
    expect(await refusal({ path: at('locked'), force: true })).toEqual({
      kind: 'locked',
      reason: 'agent running'
    })
    await removeMachineWorktree(machine, { repoPath: repo, path: at('dirty'), force: true })
    await removeMachineWorktree(machine, { repoPath: repo, path: at('gone') })
    const left = await removeMachineWorktree(machine, {
      repoPath: repo,
      path: at('locked'),
      force: true,
      unlock: true
    })

    expect(left.map((entry) => entry.path)).toEqual([repo])
  })

  it('serves live-session scans and home-chat file tools', async () => {
    const dir = await scratch()
    const host = machineLiveSessionHost({
      recordId: 'loop',
      machineId: machine.machineId,
      name: 'loop',
      executionHostId: 'x',
      connection: machine,
      ...(machine.transport === 'server' ? { serverRun: serverScan } : {})
    })
    const chat = await createUnifiedMachine(viewFor(machine), summaryFor(machine), machine)
    await chat.writeTextFile(path.join(dir, 'log', 'chat.txt'), 'one\n', { append: false })
    await chat.writeTextFile(path.join(dir, 'log', 'chat.txt'), 'two\n', { append: true })

    expect(await host.run('case "$PATH" in *"$HOME/.local/bin"*) echo scanned;; esac')).toBe(
      'scanned\n'
    )
    expect(await chat.readTextFile(path.join(dir, 'log', 'chat.txt'), 1024)).toEqual({
      text: 'one\ntwo\n',
      truncated: false
    })
  })

  it('installs a pushed login only when it is newer than the host copy', async () => {
    const older = JSON.stringify({ last_refresh: '2026-01-01T00:00:00Z', tokens: {} })
    const newer = JSON.stringify({ last_refresh: '2026-06-01T00:00:00Z', tokens: {} })
    await installLoginOnMachine(machine, { provider: 'codex', authJson: newer })
    await installLoginOnMachine(machine, { provider: 'codex', authJson: older })

    await writeFile(path.join(home, '.claude.json'), JSON.stringify({ theme: 'dark' }))
    await installLoginOnMachine(machine, {
      provider: 'claude',
      email: 'brian@example.com',
      organizationUuid: null,
      organizationName: null,
      credentialsJson: JSON.stringify({ claudeAiOauth: { accessToken: 'a', expiresAt: 5 } }),
      oauthAccountJson: JSON.stringify({ emailAddress: 'brian@example.com' })
    })

    expect(await readFile(path.join(home, '.codex', 'auth.json'), 'utf8')).toBe(newer)
    expect(JSON.parse(await readFile(path.join(home, '.claude.json'), 'utf8'))).toEqual({
      theme: 'dark',
      oauthAccount: { emailAddress: 'brian@example.com' }
    })
    expect(
      JSON.parse(await readFile(path.join(home, '.claude', '.credentials.json'), 'utf8'))
    ).toEqual({ claudeAiOauth: { accessToken: 'a', expiresAt: 5 } })
    await rm(path.join(home, '.codex'), { recursive: true, force: true })
    await rm(path.join(home, '.claude'), { recursive: true, force: true })
  })
})
