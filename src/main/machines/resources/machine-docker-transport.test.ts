import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MachineCleanupProgress } from '../../../shared/machines/machine-resource-types'
import type { MachineConnection } from '../connection/machine-connection'
import { FAKE_DOCKER_STATE_FILE, fakeDockerCliScript } from '../testing/fake-docker-cli'
import { fakeDockerState } from '../testing/fake-docker-default-state'
import { FAKE_DOCKER, type FakeDockerState } from '../testing/fake-docker-state'
import {
  createInProcessServerConnection,
  createLoopbackSshConnection
} from '../testing/machine-transport-test-doubles'
import { MachineCleanupRunner } from './machine-cleanup-runner'
import { readMachineDockerContainerLogs } from './machine-docker-container-logs'
import { listMachineDockerContainers } from './machine-docker-containers'
import { readMachineDockerDetails } from './machine-docker-details'
import { readMachineDockerStorage } from './machine-docker-inventory'
import {
  listMachineDockerVolumeDir,
  readMachineDockerVolumeFile
} from './machine-docker-volume-files'

// The same Docker answers must come back over SSH and the Seal server.
const { images, containers, volumes, buildCache } = FAKE_DOCKER
const saved = { HOME: process.env.HOME, PATH: process.env.PATH }
let home = ''

beforeAll(async () => {
  home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-docker-home-')))
  process.env.HOME = home
})

afterAll(async () => {
  process.env.HOME = saved.HOME
  process.env.PATH = saved.PATH
  await rm(home, { recursive: true, force: true })
})

const cases = [
  ['SSH', () => createLoopbackSshConnection('/bin/sh')],
  ['Seal server', () => createInProcessServerConnection()]
] as const

describe.skipIf(process.platform !== 'linux').each(cases)(
  'Docker on a machine connected via %s',
  (transport, connect) => {
    let machine: MachineConnection
    let stateFile = ''

    async function install(change: (state: FakeDockerState) => void = () => {}): Promise<void> {
      const state = fakeDockerState()
      change(state)
      await writeFile(stateFile, JSON.stringify(state))
    }

    beforeAll(async () => {
      // First on PATH, so a real docker on this host never answers.
      const bin = path.join(home, transport.replace(' ', '-'))
      await mkdir(bin)
      await writeFile(path.join(bin, 'docker'), fakeDockerCliScript())
      await chmod(path.join(bin, 'docker'), 0o755)
      stateFile = path.join(bin, FAKE_DOCKER_STATE_FILE)
      process.env.PATH = `${bin}:${path.dirname(process.execPath)}:${saved.PATH}`
      machine = connect()
    })

    it('removes what was picked, warns about stopped users, and refuses running ones', async () => {
      await install()
      const runner = new MachineCleanupRunner()
      const before = await readMachineDockerStorage(machine, { force: true })
      expect(before).toMatchObject({
        state: 'ready',
        rows: [
          { kind: 'images', count: 6, sizeBytes: 868_100_000, reclaimableBytes: 183_100_000 },
          { kind: 'containers', count: 4, sizeBytes: 28_710_000, reclaimableBytes: 28_700_000 },
          { kind: 'volumes', count: 3, sizeBytes: 2_612_000_000, reclaimableBytes: 512_000_000 },
          { kind: 'build-cache', count: 4, sizeBytes: 533_000_000, reclaimableBytes: 437_008_190 }
        ]
      })

      const imagePlan = await runner.plan(machine, 'images', [
        images.nginx.reference,
        images.node.reference,
        images.redis.reference,
        images.dangling.id
      ])
      expect(
        imagePlan.items.map((item) => [item.label, item.preselected, item.inUseBy, item.blocked])
      ).toEqual([
        [
          'nginx:1.27',
          false,
          undefined,
          'Running container web uses it. Stop the container first.'
        ],
        ['node:20-alpine', false, ['migrate'], undefined],
        ['redis:7', true, undefined, undefined],
        ['f6f6f6f6f6f6', true, undefined, undefined]
      ])
      await expect(
        runner.run(
          machine,
          imagePlan.token,
          imagePlan.items.map((item) => item.id)
        )
      ).rejects.toThrow(
        'nginx:1.27 cannot be removed here. Running container web uses it. Stop the container first.'
      )
      const progress: MachineCleanupProgress[] = []
      const removedImages = await runner.run(
        machine,
        imagePlan.token,
        imagePlan.items.filter((item) => !item.blocked).map((item) => item.id),
        (step) => progress.push(step)
      )
      expect(removedImages).toEqual({
        removedIds: ['docker-images:1', 'docker-images:2', 'docker-images:3'],
        freedBytes: 308_000_000,
        failures: []
      })
      expect(
        progress.map((step) => [step.done, step.total, step.freedBytes, step.current])
      ).toEqual([
        [0, 3, 0, 'node:20-alpine'],
        [1, 3, 127_000_000, 'redis:7'],
        [2, 3, 244_000_000, 'f6f6f6f6f6f6'],
        [3, 3, 308_000_000, null]
      ])

      const volumePlan = await runner.plan(machine, 'volumes', [
        volumes.migrations,
        volumes.scratch
      ])
      expect(volumePlan.items.map((item) => [item.label, item.inUseBy])).toEqual([
        ['scratch', undefined],
        ['migrations', ['migrate']]
      ])
      await runner.run(
        machine,
        volumePlan.token,
        volumePlan.items.map((item) => item.id)
      )

      const cachePlan = await runner.plan(machine, 'build-cache', [
        buildCache.base,
        buildCache.layer,
        buildCache.busy
      ])
      expect(cachePlan.items.map((item) => [item.label, item.blocked])).toEqual([
        ['mount / from exec /bin/sh -c npm ci', undefined],
        ['pulled from docker.io/library/node:20-alpine', undefined],
        ['cached mount /root/.npm from exec /bin/sh -c npm ci', 'A build is using it.']
      ])
      // Docker keeps a record another one builds on: alone, the base stays.
      const kept = await runner.run(machine, cachePlan.token, ['docker-build-cache:1'])
      expect(kept.failures).toEqual([
        {
          id: 'docker-build-cache:1',
          label: 'pulled from docker.io/library/node:20-alpine',
          message: 'Docker kept this record: another record builds on it, or it is already gone.'
        }
      ])
      const cacheAgain = await runner.plan(machine, 'build-cache', [
        buildCache.base,
        buildCache.layer
      ])
      expect(
        await runner.run(
          machine,
          cacheAgain.token,
          cacheAgain.items.map((item) => item.id)
        )
      ).toEqual({
        removedIds: ['docker-build-cache:0', 'docker-build-cache:1'],
        freedBytes: 437_000_000,
        failures: []
      })

      const after = await readMachineDockerStorage(machine)
      if (after.state !== 'ready') {
        throw new Error('Docker did not answer')
      }
      expect(after.images.map((image) => image.reference)).toEqual([
        'postgres:16',
        'nginx:1.27',
        'gcr.io/distroless/static:latest'
      ])
      expect(after.containers.map((container) => container.name).sort()).toEqual([
        'db',
        'old-job',
        'web'
      ])
      expect(after.volumes.map((volume) => [volume.name, volume.usedBy[0]?.name])).toEqual([
        ['pgdata', 'db']
      ])
      expect(after.buildCache.map((record) => record.id).sort()).toEqual(
        [buildCache.busy, buildCache.context].sort()
      )
    })

    it('shows running containers with their load, and details and logs of one', async () => {
      await install()
      const listing = await listMachineDockerContainers(machine)
      if (listing.state !== 'ready') {
        throw new Error('Docker did not answer')
      }
      expect(listing.containers.map((container) => container.name)).toEqual([
        'db',
        'web',
        'migrate',
        'old-job'
      ])
      expect(listing.containers[0]).toMatchObject({
        id: containers.db.id,
        image: 'postgres:16',
        running: true,
        cpuPercent: 12.25,
        memUsageBytes: 1.5 * 1024 ** 3,
        memLimitBytes: 2 * 1024 ** 3,
        netRxBytes: 48_300,
        netTxBytes: 126,
        blockReadBytes: 212_000_000,
        blockWriteBytes: 1_480_000_000,
        pids: 14
      })

      expect(
        await readMachineDockerDetails(machine, { kind: 'container', id: containers.web.id })
      ).toMatchObject({
        name: 'web',
        state: 'running',
        image: 'nginx:1.27',
        command: 'nginx -g daemon off;',
        health: 'healthy',
        restartPolicy: 'unless-stopped',
        ports: ['443/tcp', '0.0.0.0:8080->80/tcp', '[::]:8080->80/tcp'],
        exitCode: null
      })
      expect(
        await readMachineDockerDetails(machine, { kind: 'volume', id: volumes.pgdata })
      ).toMatchObject({
        containers: [
          { name: 'db', running: true, destination: '/var/lib/postgresql/data', readOnly: false }
        ]
      })
      const logs = await readMachineDockerContainerLogs(machine, containers.web.id)
      expect(logs.text.split('\n').slice(1, 3)).toEqual([
        '2026-11-16T19:58:12.004000000Z 172.17.0.1 - - "GET / HTTP/1.1" 200 615',
        '2026-11-16T19:58:14.870000000Z 172.17.0.1 - - "GET /missing HTTP/1.1" 404 153'
      ])
      expect(logs.truncated).toBe(false)
      await expect(readMachineDockerContainerLogs(machine, 'ab'.repeat(32))).rejects.toThrow(
        'This container is no longer on the machine.'
      )
    })

    it('reads a volume through its folder or a helper container, and never leaves it', async () => {
      const outside = path.join(home, `${transport}-outside.txt`)
      await writeFile(outside, 'not in the volume')
      await install((state) => {
        state.volumes[1].readable = true
        state.volumes[2].files['escape'] = ''
      })
      for (const volume of [volumes.migrations, volumes.scratch]) {
        // Listing once puts the volume's files on disk, where a link out of it can be planted.
        await listMachineDockerVolumeDir(machine, volume, '/')
      }
      const scratch = path.join(path.dirname(stateFile), 'docker-volumes', volumes.scratch)
      await rm(path.join(scratch, 'escape'))
      await symlink(outside, path.join(scratch, 'escape'))

      const direct = await listMachineDockerVolumeDir(machine, volumes.migrations, '/')
      expect(direct.entries.map((entry) => [entry.name, entry.kind, entry.size])).toEqual([
        ['001_init.sql', 'file', 45]
      ])
      const listing = await listMachineDockerVolumeDir(machine, volumes.scratch, '/')
      expect(listing.totalEntries).toBe(3)
      expect(listing.entries.map((entry) => [entry.name, entry.kind]).sort()).toEqual([
        ['escape', 'symlink'],
        ['logs', 'directory'],
        ['notes.txt', 'file']
      ])
      const file = await readMachineDockerVolumeFile(machine, volumes.scratch, '/logs/app.log')
      expect(Buffer.from(file.contentBase64, 'base64').toString()).toBe('started\nstopped\n')
      expect(file).toMatchObject({ path: '/logs/app.log', size: 16, truncated: false })

      await expect(
        readMachineDockerVolumeFile(machine, volumes.scratch, '/escape')
      ).rejects.toThrow('This link points outside the volume.')
      await expect(listMachineDockerVolumeDir(machine, volumes.scratch, '/../..')).rejects.toThrow(
        'This is not a path inside the volume.'
      )
      await expect(listMachineDockerVolumeDir(machine, 'gone', '/')).rejects.toThrow(
        'This volume is no longer on the machine.'
      )
      expect(JSON.parse(await readFile(stateFile, 'utf8')).volumes).toHaveLength(3)
    })

    it('says why Docker does not answer', async () => {
      await install((state) => {
        state.permissionDenied = true
      })
      expect(await readMachineDockerStorage(machine, { force: true })).toEqual({
        state: 'unreachable',
        reason: 'permission',
        message:
          'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock'
      })
      await install((state) => {
        state.daemonDown = true
      })
      expect(await listMachineDockerContainers(machine)).toMatchObject({
        state: 'unreachable',
        reason: 'not-running'
      })
    })
  }
)
