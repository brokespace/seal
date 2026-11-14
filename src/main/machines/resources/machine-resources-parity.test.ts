import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MachineConnection } from '../connection/machine-connection'
import { MachineDirectoryService } from '../listing/machine-directory-service'
import { completeMachineFolder } from '../listing/machine-folder-completion'
import {
  createInProcessServerConnection,
  createLoopbackSshConnection
} from '../testing/machine-transport-test-doubles'
import { MachineCleanupRunner } from './machine-cleanup-runner'
import { listMachineDiskMounts, measureMachineDiskUsage } from './machine-disk-usage'
import { probeMachineProcesses } from './machine-process-probe'
import { signalMachineProcess } from './machine-process-signal'

// The same expectations must hold over SSH and the Seal server, whatever the login shell is.
const HOST_ENV = [
  'HOME',
  'SHELL',
  'TMPDIR',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'CARGO_HOME'
] as const
const saved = Object.fromEntries(HOST_ENV.map((name) => [name, process.env[name]]))
let home = ''

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-resources-home-')))
  for (const name of HOST_ENV) {
    delete process.env[name]
  }
  process.env.HOME = home
  process.env.TMPDIR = path.join(home, 'tmp')
  await mkdir(process.env.TMPDIR)
})

afterAll(async () => {
  for (const name of HOST_ENV) {
    if (saved[name] === undefined) {
      delete process.env[name]
    } else {
      process.env[name] = saved[name]
    }
  }
  await rm(home, { recursive: true, force: true })
})

function installedShell(name: string): string | null {
  return (
    ['/bin', '/usr/bin', '/usr/local/bin']
      .map((dir) => path.join(dir, name))
      .find((candidate) => existsSync(candidate)) ?? null
  )
}

const cases = ['sh', 'bash', 'zsh', 'fish'].flatMap((name) => {
  const shell = installedShell(name)
  return shell
    ? ([
        [name, 'SSH', shell, () => createLoopbackSshConnection(shell)],
        [name, 'Seal server', shell, () => createInProcessServerConnection()]
      ] as const)
    : []
})

async function put(file: string, bytes: number): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, randomBytes(bytes))
}

function busyLoop(prelude: string, ...args: string[]): ChildProcess {
  return spawn('/bin/sh', ['-c', `${prelude}while :; do :; done`, ...args], { stdio: 'ignore' })
}

describe.skipIf(process.platform !== 'linux').each(cases)(
  'a machine whose login shell is %s, connected via %s',
  (_shellName, _transport, shell, connect) => {
    let machine: MachineConnection

    beforeAll(() => {
      process.env.SHELL = shell
      machine = connect()
    })

    it('lists busy processes, masks secrets, and stops only the process that was picked', async () => {
      const polite = busyLoop('', 'seal-busy', '--api-key=hunter2')
      const stubborn = busyLoop('trap "" TERM; ', 'seal-stubborn')
      try {
        const snapshot = await probeMachineProcesses(machine)
        const listed = snapshot.processes.find((process) => process.pid === polite.pid)
        const deaf = snapshot.processes.find((process) => process.pid === stubborn.pid)

        expect(listed).toMatchObject({
          user: os.userInfo().username,
          name: 'sh',
          command: '/bin/sh -c while :; do :; done seal-busy --api-key=••••',
          agent: null,
          carriesSealConnection: false
        })
        expect(listed!.cpuPercent).toBeGreaterThan(5)
        expect(listed!.rssBytes).toBeGreaterThan(0)

        const pid = polite.pid!
        const reused = await signalMachineProcess(machine, {
          pid,
          signal: 'TERM',
          startMarker: `${listed!.startMarker}0`
        })
        expect(reused).toEqual({ outcome: 'replaced' })
        expect(polite.signalCode).toBeNull()

        const politeExit = once(polite, 'exit')
        const request = { pid, signal: 'TERM', startMarker: listed!.startMarker } as const
        expect(await signalMachineProcess(machine, request)).toEqual({ outcome: 'sent' })
        expect(await politeExit).toEqual([null, 'SIGTERM'])
        expect(await signalMachineProcess(machine, request)).toEqual({ outcome: 'gone' })

        const stubbornExit = once(stubborn, 'exit')
        const force = { pid: stubborn.pid!, startMarker: deaf!.startMarker }
        expect(await signalMachineProcess(machine, { ...force, signal: 'TERM' })).toEqual({
          outcome: 'sent'
        })
        expect(await signalMachineProcess(machine, { ...force, signal: 'KILL' })).toEqual({
          outcome: 'sent'
        })
        expect(await stubbornExit).toEqual([null, 'SIGKILL'])
      } finally {
        polite.kill('SIGKILL')
        stubborn.kill('SIGKILL')
      }
    })

    it('refuses to signal init or a process group', async () => {
      for (const pid of [1, 0, -1]) {
        await expect(
          signalMachineProcess(machine, { pid, signal: 'KILL', startMarker: 't1' })
        ).rejects.toThrow('Refusing to signal this process id')
      }
    })

    it('sizes what sits under a folder, largest first', async () => {
      const dir = path.join(home, 'usage')
      await put(path.join(dir, 'big.bin'), 3 * 1024 * 1024)
      await put(path.join(dir, 'sub dir', 'inner.bin'), 1024 * 1024)
      await put(path.join(dir, 'note.txt'), 64 * 1024)
      await symlink('/etc', path.join(dir, 'link'))

      const usage = await measureMachineDiskUsage(machine, dir)
      const mounts = await listMachineDiskMounts(machine)
      await rm(dir, { recursive: true })

      expect(usage.entries.map((entry) => [entry.name, entry.kind, entry.path])).toEqual([
        ['big.bin', 'file', path.join(dir, 'big.bin')],
        ['sub dir', 'directory', path.join(dir, 'sub dir')],
        ['note.txt', 'file', path.join(dir, 'note.txt')],
        ['link', 'symlink', path.join(dir, 'link')]
      ])
      expect(usage.entries[0].bytes).toBeGreaterThanOrEqual(3 * 1024 * 1024)
      expect(usage.entries[1].bytes).toBeGreaterThanOrEqual(1024 * 1024)
      expect(usage.totalBytes).toBeGreaterThanOrEqual(4 * 1024 * 1024 + 64 * 1024)
      expect(usage).toMatchObject({ omittedCount: 0, incomplete: false })
      expect(mounts.map((mount) => mount.mount)).toContain('/')
    })

    it('removes exactly the cleanup items that were confirmed, once', async () => {
      const npm = path.join(home, '.npm', '_cacache')
      const pip = path.join(home, '.cache', 'pip')
      await put(path.join(npm, 'blob'), 300_000)
      await put(path.join(pip, 'wheel'), 100_000)
      const cleanups = new MachineCleanupRunner()

      const scan = await cleanups.scan(machine, 'package-caches')
      expect(scan.items.map((item) => [item.group, item.label, item.preselected])).toEqual([
        ['npm', npm, true],
        ['pip', pip, true]
      ])
      await expect(cleanups.run(machine, scan.token, ['package-caches:7'])).rejects.toThrow(
        'Pick items from the current cleanup list.'
      )
      expect(existsSync(npm)).toBe(true)

      const result = await cleanups.run(machine, scan.token, [scan.items[0].id])
      expect(result).toMatchObject({ removedIds: ['package-caches:0'], failures: [] })
      expect(result.freedBytes).toBeGreaterThanOrEqual(300_000)
      expect(existsSync(npm)).toBe(false)
      expect(existsSync(pip)).toBe(true)
      await expect(cleanups.run(machine, scan.token, [scan.items[1].id])).rejects.toThrow(
        'This cleanup list is no longer current. Scan again.'
      )
      expect(existsSync(pip)).toBe(true)
      await rm(pip, { recursive: true })
    })

    it('lists only what each cleanup owns', async () => {
      const project = path.join(home, 'app', 'node_modules')
      await put(path.join(project, 'pkg', 'index.js'), 10_000)
      await put(path.join(home, '.tool', 'node_modules', 'x.js'), 10_000)
      const trash = path.join(home, '.local', 'share', 'Trash')
      const trashed = path.join(trash, 'files', 'old.txt')
      await put(trashed, 10_000)
      const finished = path.join(home, '.seal', 'jobs', 'finished')
      await put(path.join(finished, 'exit'), 1)
      await put(path.join(home, '.seal', 'jobs', 'running', 'pid'), 1)
      const oldLog = path.join(home, '.npm', '_logs', 'old.log')
      await put(oldLog, 10_000)
      await put(path.join(home, '.npm', '_logs', 'fresh.log'), 10_000)
      const longAgo = new Date('2024-01-01T00:00:00Z')
      await utimes(oldLog, longAgo, longAgo)
      const cleanups = new MachineCleanupRunner()

      const modules = await cleanups.scan(machine, 'node-modules')
      const logs = await cleanups.scan(machine, 'old-logs')
      const jobs = await cleanups.scan(machine, 'seal-caches')
      const bin = await cleanups.scan(machine, 'trash')
      await cleanups.run(machine, bin.token, [bin.items[0].id])
      await cleanups.run(machine, logs.token, [logs.items[0].id])

      expect(modules.items.map((item) => [item.label, item.preselected])).toEqual([
        [project, false]
      ])
      expect(logs.items.map((item) => item.label)).toEqual([oldLog])
      expect(jobs.items.map((item) => [item.group, item.label])).toEqual([
        ['finished job', finished]
      ])
      expect(bin.items.map((item) => item.label)).toEqual([trash])
      expect(await readdir(path.dirname(trashed))).toEqual([])
      expect(await readdir(path.dirname(oldLog))).toEqual(['fresh.log'])
      for (const dir of ['app', '.tool', '.seal', '.npm']) {
        await rm(path.join(home, dir), { recursive: true })
      }
    })

    it('completes a typed folder path', async () => {
      const base = path.join(home, 'go')
      for (const name of ['projects', 'Prototypes', '.private']) {
        await mkdir(path.join(base, name), { recursive: true })
      }
      await writeFile(path.join(base, 'profile.txt'), 'x')
      const directories = new MachineDirectoryService({
        resolveFileSystem: () => machine.files,
        onDirChanged: () => {}
      })
      const names = async (typed: string): Promise<string[]> => {
        const completion = await completeMachineFolder(
          (dir, offset) => directories.listDir(machine.machineId, dir, { offset, force: true }),
          path.join(base, typed)
        )
        return completion.matches.map((match) => match.path)
      }

      const lower = await names('pro')
      const mixed = await names('PRO')
      const hidden = await names('.p')
      directories.dispose()
      await rm(base, { recursive: true })

      expect(lower).toEqual([path.join(base, 'projects')])
      expect(mixed).toEqual([path.join(base, 'projects'), path.join(base, 'Prototypes')])
      expect(hidden).toEqual([path.join(base, '.private')])
    })
  }
)
