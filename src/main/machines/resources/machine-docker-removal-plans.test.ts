import { describe, expect, it } from 'vitest'
import type { MachineDockerContainerRef } from '../../../shared/machines/machine-docker-types'
import type { MachineCleanupProgress } from '../../../shared/machines/machine-resource-types'
import { createLocalMachineConnection } from '../connection/local-machine-connection'
import type { MachineConnection } from '../connection/machine-connection'
import { MachineCleanupRunner } from './machine-cleanup-runner'
import type { DockerStorage } from './machine-docker-inventory'
import { dockerCleanupPlan, dockerRemovalPlan } from './machine-docker-removal-plans'

const WEB_ID = '11'.repeat(32)
const JOB_ID = '22'.repeat(32)
const SEED_ID = '33'.repeat(32)
const web: MachineDockerContainerRef = { id: WEB_ID, name: 'web', state: 'running', running: true }
const job: MachineDockerContainerRef = { id: JOB_ID, name: 'job', state: 'exited', running: false }
const seed: MachineDockerContainerRef = {
  id: SEED_ID,
  name: 'seed',
  state: 'created',
  running: false
}
const NGINX_ID = `sha256:${'a'.repeat(64)}`
const NODE_ID = `sha256:${'b'.repeat(64)}`
const APP_ID = `sha256:${'c'.repeat(64)}`
const REDIS_ID = `sha256:${'d'.repeat(64)}`
const DANGLING_ID = `sha256:${'e'.repeat(64)}`

function image(id: string, reference: string | null, usedBy: MachineDockerContainerRef[]) {
  return { id, reference, sizeBytes: 200, uniqueBytes: 100, createdAt: null, usedBy }
}

function container(ref: MachineDockerContainerRef, imageName: string, volumes: string[]) {
  return {
    ...ref,
    image: imageName,
    imageId: null,
    status: '',
    sizeBytes: 10,
    createdAt: null,
    volumes
  }
}

function volume(name: string, usedBy: MachineDockerContainerRef[]) {
  return { name, driver: 'local', mountpoint: `/volumes/${name}`, sizeBytes: 50, usedBy }
}

function record(id: string, parents: string[], inUse = false) {
  return {
    id,
    cacheType: 'regular',
    description: `step ${id}`,
    sizeBytes: 5,
    inUse,
    shared: false,
    createdAt: null,
    lastUsedAt: 1_700_000_000_000,
    parents
  }
}

const STORAGE: DockerStorage = {
  state: 'ready',
  rows: [{ kind: 'build-cache', count: 4, sizeBytes: 20, reclaimableBytes: 15 }],
  images: [
    image(NGINX_ID, 'nginx:1.27', [web, job]),
    image(NODE_ID, 'node:20', [job]),
    image(APP_ID, 'app:1', [seed]),
    image(APP_ID, 'app:latest', [seed]),
    image(REDIS_ID, 'redis:7', []),
    image(DANGLING_ID, null, [])
  ],
  containers: [
    container(web, 'nginx:1.27', ['pgdata']),
    container(job, 'node:20', ['jobdata']),
    container(seed, 'app:1', ['jobdata'])
  ],
  volumes: [volume('pgdata', [web]), volume('jobdata', [job, seed]), volume('scratch', [])],
  buildCache: [
    record('base', []),
    record('middle', ['base']),
    record('top', ['middle']),
    record('busy', [], true)
  ],
  buildCacheOmitted: 0,
  collectedAt: 0
}

function removal(kind: Parameters<typeof dockerRemovalPlan>[1], keys: string[]) {
  return dockerRemovalPlan(STORAGE, kind, keys).plan.items.map(
    ({ label, preselected, inUseBy, blocked, action }) => ({
      label,
      preselected,
      inUseBy,
      blocked,
      action
    })
  )
}

describe('a Docker removal plan', () => {
  it('removes an unused image plainly, forces one a stopped container uses, and blocks a running one', () => {
    const picked = ['nginx:1.27', 'node:20', 'app:1', 'redis:7', DANGLING_ID, 'never-listed:1']
    expect(removal('images', picked)).toEqual([
      {
        label: 'nginx:1.27',
        preselected: false,
        inUseBy: undefined,
        blocked: 'Running container web uses it. Stop the container first.',
        action: { kind: 'docker-image', target: 'nginx:1.27', force: false }
      },
      {
        label: 'node:20',
        preselected: false,
        inUseBy: ['job'],
        blocked: undefined,
        // By id: forcing the only tag away would leave the image behind, untagged.
        action: { kind: 'docker-image', target: NODE_ID, force: true }
      },
      {
        label: 'app:1',
        preselected: false,
        inUseBy: ['seed'],
        blocked: undefined,
        action: { kind: 'docker-image', target: 'app:1', force: true }
      },
      {
        label: 'redis:7',
        preselected: true,
        inUseBy: undefined,
        blocked: undefined,
        action: { kind: 'docker-image', target: 'redis:7', force: false }
      },
      {
        label: 'eeeeeeeeeeee',
        preselected: true,
        inUseBy: undefined,
        blocked: undefined,
        action: { kind: 'docker-image', target: DANGLING_ID, force: false }
      }
    ])
  })

  it('removes a stopped container and blocks a running one', () => {
    expect(removal('containers', [WEB_ID, JOB_ID])).toEqual([
      {
        label: 'web',
        preselected: false,
        inUseBy: undefined,
        blocked: 'Running. Stop it first.',
        action: { kind: 'docker', args: ['container', 'rm', WEB_ID] }
      },
      {
        label: 'job',
        preselected: true,
        inUseBy: undefined,
        blocked: undefined,
        action: { kind: 'docker', args: ['container', 'rm', JOB_ID] }
      }
    ])
  })

  it('removes the stopped containers of a volume before the volume, and blocks a mounted one', () => {
    expect(removal('volumes', ['pgdata', 'jobdata', 'scratch'])).toEqual([
      {
        label: 'pgdata',
        preselected: false,
        inUseBy: undefined,
        blocked: 'Running container web uses it. Stop the container first.',
        action: { kind: 'docker', args: ['volume', 'rm', 'pgdata'] }
      },
      {
        label: 'jobdata',
        preselected: false,
        inUseBy: ['job', 'seed'],
        blocked: undefined,
        action: {
          kind: 'docker-sequence',
          commands: [
            ['container', 'rm', JOB_ID, SEED_ID],
            ['volume', 'rm', 'jobdata']
          ]
        }
      },
      {
        label: 'scratch',
        preselected: true,
        inUseBy: undefined,
        blocked: undefined,
        action: { kind: 'docker', args: ['volume', 'rm', 'scratch'] }
      }
    ])
  })

  it('removes build cache records before the ones they build on, and blocks one in use', () => {
    expect(
      removal('build-cache', ['base', 'middle', 'top', 'busy']).map((item) => [
        item.label,
        item.blocked,
        item.action
      ])
    ).toEqual([
      ['step top', undefined, { kind: 'docker-build-cache', record: 'top' }],
      ['step middle', undefined, { kind: 'docker-build-cache', record: 'middle' }],
      ['step base', undefined, { kind: 'docker-build-cache', record: 'base' }],
      ['step busy', 'A build is using it.', { kind: 'docker-build-cache', record: 'busy' }]
    ])
  })

  it('prunes only what nothing uses', () => {
    const labels = (target: Parameters<typeof dockerCleanupPlan>[1]) =>
      dockerCleanupPlan(STORAGE, target).items.map((item) => [item.label, item.preselected])
    expect(labels('docker-images')).toEqual([
      ['redis:7', false],
      ['eeeeeeeeeeee', false]
    ])
    expect(labels('docker-dangling-images')).toEqual([['eeeeeeeeeeee', true]])
    expect(labels('docker-containers')).toEqual([
      ['job', false],
      ['seed', false]
    ])
    expect(labels('docker-volumes')).toEqual([['scratch', false]])
    expect(dockerCleanupPlan(STORAGE, 'docker-build-cache').items).toEqual([
      {
        id: 'docker-build-cache:0',
        label: 'docker builder prune --all',
        group: null,
        bytes: 15,
        modifiedAt: null,
        preselected: true,
        action: { kind: 'docker-build-cache', record: null }
      }
    ])
  })

  it('passes on why Docker gave no list', () => {
    expect(dockerCleanupPlan({ state: 'missing' }, 'docker-volumes').unavailable).toBe(
      'Docker is not installed on this machine.'
    )
  })
})

/** A machine with 44 unused volumes and one a running container mounts; every removal succeeds. */
function machineWithManyVolumes(): MachineConnection {
  const inventory = [
    '@ready',
    `@k {"Id":"${WEB_ID}","Name":"/web","State":"running","Running":true,"Image":"nginx:1.27","ImageID":"${NGINX_ID}","Mounts":[{"Type":"volume","Name":"v44","Destination":"/data","RW":true}]}`,
    ...Array.from({ length: 45 }, (_, index) => `@v {"Name":"v${index}","Links":"0","Size":"1kB"}`)
  ].join('\n')
  return {
    ...createLocalMachineConnection(),
    machineId: 'machine:many',
    dialect: async () => 'posix',
    exec: async (_command, options) => {
      const script = String(options.stdin ?? '')
      const stdout = script.includes('docker system df')
        ? inventory
        : [...script.matchAll(/echo "@ok (\d+) /g)].map((match) => `@ok ${match[1]} `).join('\n')
      return { stdout, stderr: '', exitCode: 0, timedOut: false }
    }
  }
}

describe('a cleanup run', () => {
  it('refuses a blocked item, then reports as it removes the rest in batches', async () => {
    const machine = machineWithManyVolumes()
    const runner = new MachineCleanupRunner()
    const plan = await runner.plan(
      machine,
      'volumes',
      Array.from({ length: 45 }, (_, index) => `v${index}`)
    )
    const ids = plan.items.map((item) => item.id)

    await expect(runner.run(machine, plan.token, ids)).rejects.toThrow(
      'v44 cannot be removed here. Running container web uses it. Stop the container first.'
    )
    await expect(runner.run(machine, plan.token, ['docker-volumes:99'])).rejects.toThrow(
      'Pick items from the current cleanup list.'
    )

    const progress: MachineCleanupProgress[] = []
    const result = await runner.run(machine, plan.token, ids.slice(0, 44), (step) =>
      progress.push(step)
    )
    expect(result.removedIds).toHaveLength(44)
    expect(result.freedBytes).toBe(44_000)
    expect(progress.map((step) => step.done)).toEqual([
      0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 44
    ])
    expect(progress[5]).toEqual({
      token: plan.token,
      done: 15,
      total: 44,
      freedBytes: 15_000,
      failed: 0,
      current: 'v15'
    })
    expect(progress.at(-1)).toMatchObject({ done: 44, freedBytes: 44_000, current: null })
    await expect(runner.run(machine, plan.token, ids.slice(0, 1))).rejects.toThrow(
      'This cleanup list is no longer current. Scan again.'
    )
  })
})
