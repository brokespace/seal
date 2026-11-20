import React, { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toRuntimeExecutionHostId } from '../../../../../shared/execution-host'
import type {
  MachineDockerStorage,
  MachineDockerStorageKind
} from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { fakeMachinesApi, KESSEL, METRICS } from '../machine-api-fixture'
import { MachineDiskDetail } from './MachineDiskDetail'
import { clearMachineDockerStorageCache, useMachineDockerStorage } from './MachineDockerStorage'
import { MachineDockerStorageManager } from './MachineDockerStorageManager'

type Api = typeof fakeMachinesApi

const MACHINE: MachineSummary = {
  id: toMachineId(KESSEL),
  connection: 'ssh',
  label: 'kessel-ml',
  address: 'brian@kessel-ml:22',
  status: 'online',
  statusDetail: null,
  os: 'linux',
  sshTargetId: 'kessel-ssh',
  runtimeEnvironmentId: KESSEL,
  executionHostId: toRuntimeExecutionHostId(KESSEL)
}

const GB = 1024 ** 3
const WIDE = 920
const NARROW = 560

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function press(text: string): void {
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="tab"]'))
  const target = buttons.find((button) => button.textContent?.trim() === text)
  // Radix tabs select on mousedown, not click.
  target?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
  target?.click()
}

function tick(...names: string[]): void {
  for (const name of names) {
    document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="Select ${name}"]`)?.click()
  }
}

type Step = () => void

async function play(steps: Step[]): Promise<void> {
  await wait(300)
  for (const step of steps) {
    step()
    await wait(250)
  }
}

function Manager({ category: initial }: { category: MachineDockerStorageKind }): React.JSX.Element {
  const docker = useMachineDockerStorage(MACHINE.id)
  const [category, setCategory] = useState(initial)
  return (
    // The resource panel is the container the manager's columns respond to.
    <div className="@container bg-background">
      <div className="overflow-clip rounded-xl border border-border bg-card">
        <MachineDockerStorageManager
          machine={MACHINE}
          docker={docker}
          category={category}
          onCategory={setCategory}
          onChanged={() => void docker.reload({ force: true })}
        />
      </div>
    </div>
  )
}

function manager(
  category: MachineDockerStorageKind,
  width = WIDE,
  steps: Step[] = [],
  api: Partial<Api> = {}
) {
  return defineFixture({
    width,
    setup: () => {
      window.api.machines = { ...fakeMachinesApi, ...api }
    },
    render: () => <Manager category={category} />,
    interact: () => play(steps)
  })
}

function unavailable(storage: MachineDockerStorage, width = NARROW) {
  return manager('images', width, [], { dockerStorage: async () => storage })
}

export const images = manager('images')

export const imagesNarrow = manager('images', NARROW)

export const imagesSlim = manager('images', 420)

export const imagesUnusedOnly = manager('images', NARROW, [() => press('Unused only')])

export const containers = manager('containers')

export const containersNarrow = manager('containers', NARROW)

export const volumes = manager('volumes')

export const volumesNarrow = manager('volumes', NARROW)

export const buildCache = manager('build-cache')

export const buildCacheNarrow = manager('build-cache', NARROW)

const PICKED_IMAGES = ['nvidia/cuda:12.4.1-devel', 'seal/eval:2026.04', '9f1c2ab04e77']

export const selection = manager('images', WIDE, [() => tick(...PICKED_IMAGES)])

export const selectionNarrow = manager('images', NARROW, [() => tick(...PICKED_IMAGES)])

const REVIEW_IMAGES: Step[] = [
  () => tick('nvidia/cuda:12.4.1-devel', 'seal/eval:2026.04', 'jupyter/pytorch-notebook:latest'),
  () => press('Remove selected')
]

export const removeSelectedDialog = manager('images', WIDE, REVIEW_IMAGES)

function tickInUseInDialog(): void {
  document
    .querySelector<HTMLElement>('[data-machine-cleanup-item="in-use"] [role="checkbox"]')
    ?.click()
}

export const removeSelectedInUseTicked = manager('images', WIDE, [
  ...REVIEW_IMAGES,
  tickInUseInDialog
])

const REVIEW_VOLUMES: Step[] = [
  () => tick('hf-cache', 'mlflow-artifacts', 'pgdata'),
  () => press('Remove selected')
]

export const removeVolumesDialog = manager('volumes', WIDE, [...REVIEW_VOLUMES, tickInUseInDialog])

export const removeAllBlocked = manager('containers', WIDE, [
  () => tick('postgres', 'jupyter'),
  () => press('Remove selected')
])

/** A cleanup that never ends, three items in. */
const RUNNING: Partial<Api> = {
  runCleanup: () => new Promise(() => {}),
  onCleanupProgress: (callback) => {
    const timer = setTimeout(() => {
      for (const token of ['removal:images', 'docker-containers']) {
        callback({
          token,
          done: 3,
          total: 12,
          freedBytes: 4.2 * GB,
          failed: 0,
          current: 'seal/eval:2026.04'
        })
      }
    }, 50)
    return () => clearTimeout(timer)
  }
}

export const removeSelectedRunning = manager(
  'images',
  WIDE,
  [
    () => tick('nvidia/cuda:12.4.1-devel', '9f1c2ab04e77', '51d0a6c3be19'),
    () => press('Remove selected'),
    () => document.querySelector<HTMLElement>('[data-machine-cleanup-confirm]')?.click()
  ],
  RUNNING
)

export const prunePartialFailure = manager(
  'images',
  WIDE,
  [
    () => press('Prune dangling images'),
    () => document.querySelector<HTMLElement>('[data-machine-cleanup-confirm]')?.click()
  ],
  {
    runCleanup: async ({ itemIds }) => ({
      removedIds: itemIds.slice(0, 1),
      freedBytes: 7.4 * GB,
      failures: [
        {
          id: itemIds[1] ?? 'x',
          label: '51d0a6c3be19',
          message:
            'Error response from daemon: conflict: unable to delete 51d0a6c3be19 (cannot be forced) - image is being used by running container 7a8b9c0d1e2f'
        }
      ]
    })
  }
)

const OPEN_CLEAN_UP: Step = () => press('Clean up unused')
const CONFIRM_CLEAN_UP: Step = () =>
  document.querySelector<HTMLElement>('[data-machine-docker-clean-up-confirm]')?.click()

/** A second unused volume, an anonymous one, so the disclosure has a long name to fit. */
const PRUNABLE: Partial<Api> = {
  scanCleanup: async (args) => {
    const scan = await fakeMachinesApi.scanCleanup(args)
    return args.target === 'docker-volumes'
      ? {
          ...scan,
          items: [
            ...scan.items.map((item) => ({ ...item, label: 'hf-cache', bytes: 14.2 * GB })),
            {
              id: 'docker-volumes:1',
              label: '5e6f7a8b9c0d5e6f7a8b9c0d5e6f7a8b9c0d5e6f7a8b9c0d5e6f7a8b9c0d5e6f',
              group: null,
              bytes: 812 * 1024 ** 2,
              modifiedAt: null,
              preselected: false
            }
          ]
        }
      : scan
  }
}

export const cleanUpDialog = manager('images', WIDE, [OPEN_CLEAN_UP], PRUNABLE)

export const cleanUpDialogNarrow = manager('images', 420, [OPEN_CLEAN_UP], PRUNABLE)

export const cleanUpVolumesTicked = manager(
  'images',
  WIDE,
  [
    OPEN_CLEAN_UP,
    () =>
      document
        .querySelector<HTMLElement>(
          '[data-machine-docker-clean-up-category="docker-volumes"] [role="checkbox"]'
        )
        ?.click(),
    () =>
      document
        .querySelector<HTMLElement>(
          '[data-machine-docker-clean-up-category="docker-volumes"] [data-machine-docker-clean-up-items]'
        )
        ?.click()
  ],
  PRUNABLE
)

export const cleanUpNothing = manager('images', WIDE, [OPEN_CLEAN_UP], {
  scanCleanup: async (args) => ({
    ...(await fakeMachinesApi.scanCleanup(args)),
    items: [],
    totalBytes: 0
  })
})

export const cleanUpRunning = manager('images', WIDE, [OPEN_CLEAN_UP, CONFIRM_CLEAN_UP], {
  ...PRUNABLE,
  ...RUNNING
})

export const cleanUpDone = manager('images', WIDE, [OPEN_CLEAN_UP, CONFIRM_CLEAN_UP], {
  ...PRUNABLE,
  runCleanup: async ({ token, itemIds }) =>
    token === 'docker-dangling-images'
      ? {
          removedIds: itemIds.slice(0, 1),
          freedBytes: 7.4 * GB,
          failures: [
            {
              id: itemIds[1] ?? 'x',
              label: '51d0a6c3be19',
              message:
                'Error response from daemon: conflict: unable to delete 51d0a6c3be19 (cannot be forced) - image is being used by running container 7a8b9c0d1e2f'
            }
          ]
        }
      : {
          removedIds: itemIds,
          freedBytes: token === 'docker-containers' ? 1.9 * GB : 44 * GB,
          failures: []
        }
})

export const permissionDenied = unavailable({
  state: 'unreachable',
  reason: 'permission',
  message:
    'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.47/info": dial unix /var/run/docker.sock: connect: permission denied'
})

export const permissionDeniedUnknownUser = defineFixture({
  width: NARROW,
  setup: () => {
    window.api.machines = {
      ...fakeMachinesApi,
      dockerStorage: async () => ({
        state: 'unreachable',
        reason: 'permission',
        message: 'permission denied while trying to connect to the Docker daemon socket'
      })
    }
  },
  render: () => (
    <div className="@container bg-background">
      <MachineDiskDetail
        machine={{ ...MACHINE, connection: 'server', address: 'kessel-ml' }}
        metrics={METRICS[toMachineId(KESSEL)] ?? null}
        onReveal={() => {}}
      />
    </div>
  ),
  interact: () => play([() => press('Docker')])
})

export const missing = unavailable({ state: 'missing' })

export const notRunning = unavailable({
  state: 'unreachable',
  reason: 'not-running',
  message:
    'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'
})

export const noAnswer = unavailable({
  state: 'unreachable',
  reason: 'other',
  message: 'context deadline exceeded'
})

export const readFailed = manager('images', NARROW, [], {
  dockerStorage: async () => {
    throw new Error('kessel-ml is not connected.')
  }
})

function failingAfterFirstRead(): Api['dockerStorage'] {
  let reads = 0
  return async (args) => {
    reads += 1
    if (reads > 1) {
      throw new Error('kessel-ml is not connected.')
    }
    return fakeMachinesApi.dockerStorage(args)
  }
}

export const readFailedWithData = defineFixture({
  width: NARROW,
  setup: () => {
    window.api.machines = { ...fakeMachinesApi, dockerStorage: failingAfterFirstRead() }
  },
  render: () => <Manager category="volumes" />,
  interact: () =>
    play([() => document.querySelector<HTMLElement>('[data-machine-docker-refresh]')?.click()])
})

export const empty = manager('containers', NARROW, [], {
  dockerStorage: async (args) => {
    const storage = await fakeMachinesApi.dockerStorage(args)
    return storage.state === 'ready'
      ? {
          ...storage,
          containers: [],
          rows: storage.rows.map((row) =>
            row.kind === 'containers'
              ? { ...row, count: 0, sizeBytes: 0, reclaimableBytes: 0 }
              : row
          )
        }
      : storage
  }
})

export const rowOpensDetails = manager('volumes', WIDE, [
  () => document.querySelector<HTMLElement>('[data-machine-docker-row="hf-cache"]')?.click()
])

function diskDetail(width: number, steps: Step[], api: Partial<Api> = {}) {
  return defineFixture({
    width,
    setup: () => {
      clearMachineDockerStorageCache()
      window.api.machines = { ...fakeMachinesApi, ...api }
    },
    render: () => (
      <div className="@container bg-background">
        <MachineDiskDetail
          machine={MACHINE}
          metrics={METRICS[toMachineId(KESSEL)] ?? null}
          onReveal={() => {}}
        />
      </div>
    ),
    interact: () => play(steps)
  })
}

export const diskDockerTab = diskDetail(WIDE, [() => press('Manage')])

export const diskDockerTabNarrow = diskDetail(NARROW, [
  () => document.querySelector<HTMLElement>('[data-machine-docker-storage-stat="volumes"]')?.click()
])

export const diskDockerCard = diskDetail(WIDE, [])

export const diskDockerCardNarrow = diskDetail(NARROW, [])

/** The first Docker read is still running. */
export const diskDockerCardLoading = diskDetail(WIDE, [], {
  dockerStorage: () => new Promise(() => {})
})

export const diskDockerCardMissing = diskDetail(WIDE, [], {
  dockerStorage: async () => ({ state: 'missing' })
})

export const diskDockerCardEmpty = diskDetail(WIDE, [], {
  dockerStorage: async () => ({
    ...(await fakeMachinesApi.dockerStorage({ machineId: MACHINE.id })),
    rows: []
  })
})
