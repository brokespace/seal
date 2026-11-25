import { useState } from 'react'
import { defineFixture } from '../../../component-fixtures/component-fixture'
import { toRuntimeExecutionHostId } from '../../../../../shared/execution-host'
import type { MachineDockerDetailTarget } from '../../../../../shared/machines/machine-docker-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { toMachineId } from '../../../../../shared/machines/machine-types'
import { fakeMachinesApi, KESSEL } from '../machine-api-fixture'
import {
  FAKE_DOCKER_IMAGES,
  FAKE_DOCKER_STORED_CONTAINERS,
  FAKE_DOCKER_VOLUMES
} from '../machine-docker-fixture-data'
import { MachineDockerDetailSheet } from './MachineDockerDetailSheet'

const MACHINE: MachineSummary = {
  id: toMachineId(KESSEL),
  connection: 'server',
  label: 'kessel-ml',
  address: 'kessel-ml',
  status: 'online',
  statusDetail: null,
  os: 'linux',
  sshTargetId: 'kessel-ssh',
  runtimeEnvironmentId: KESSEL,
  executionHostId: toRuntimeExecutionHostId(KESSEL)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function Sheet({ open, sheetWidth }: { open: MachineDockerDetailTarget; sheetWidth?: number }) {
  const [target, setTarget] = useState<MachineDockerDetailTarget | null>(open)
  return (
    <>
      {/* The shot's window has one size, so a small window's sheet is drawn by narrowing it. */}
      {sheetWidth ? (
        <style>{`[data-machine-docker-detail] { width: ${sheetWidth}px !important; }`}</style>
      ) : null}
      <div className="bg-background p-6 text-sm text-muted-foreground" style={{ minHeight: 860 }}>
        {target ? 'The Machines page stays behind the sheet.' : 'The sheet closed.'}
      </div>
      <MachineDockerDetailSheet
        machine={MACHINE}
        target={target}
        onTarget={setTarget}
        onChanged={() => {}}
      />
    </>
  )
}

function sheet(
  open: MachineDockerDetailTarget,
  options: {
    afterOpen?: (page: HTMLElement) => void
    api?: typeof fakeMachinesApi
    /** As wide as the sheet gets in a 400px window. */
    narrow?: boolean
    /** How long what `afterOpen` opened takes to draw. */
    settleMs?: number
  } = {}
) {
  return defineFixture({
    width: 1100,
    setup: () => {
      window.api.machines = options.api ?? fakeMachinesApi
    },
    render: () => <Sheet open={open} sheetWidth={options.narrow ? 368 : undefined} />,
    interact: async () => {
      await wait(500)
      // The sheet is portaled, so what it holds is found from the page, not the frame.
      options.afterOpen?.(document.body)
      await wait(options.settleMs ?? 500)
    }
  })
}

function pressFile(page: HTMLElement, name: string): void {
  Array.from(page.querySelectorAll<HTMLElement>('[data-machine-docker-detail] [role="treeitem"]'))
    .find((row) => row.textContent?.includes(name))
    ?.click()
}

/** The editor that shows a file loads on first use. */
const PREVIEW_SETTLE_MS = 2_500

function press(page: HTMLElement, text: string): void {
  Array.from(page.querySelectorAll<HTMLElement>('[data-machine-docker-detail] button'))
    .find((button) => button.textContent?.trim() === text)
    ?.click()
}

function stored(name: string): MachineDockerDetailTarget {
  const container = FAKE_DOCKER_STORED_CONTAINERS.find((entry) => entry.name === name)
  return { kind: 'container', id: container?.id ?? name }
}

const JUPYTER_IMAGE: MachineDockerDetailTarget = {
  kind: 'image',
  id: FAKE_DOCKER_IMAGES.find((image) => image.reference?.startsWith('jupyter/'))?.id ?? ''
}

const PGDATA: MachineDockerDetailTarget = { kind: 'volume', id: 'pgdata' }

export const container = sheet(stored('postgres'))

export const containerNarrow = sheet(stored('postgres'), { narrow: true })

export const containerStopConfirm = sheet(stored('postgres'), {
  afterOpen: (page) => press(page, 'Stop')
})

export const containerStopped = sheet(stored('eval-run-0412'))

export const containerRemoveConfirm = sheet(stored('eval-run-0412'), {
  afterOpen: (page) => press(page, 'Remove')
})

export const containerNoLogs = sheet(stored('eval-run-0412'), {
  api: {
    ...fakeMachinesApi,
    dockerContainerLogs: async () => ({ text: '', truncated: false, collectedAt: Date.now() })
  }
})

export const containerLongLogs = sheet(stored('postgres'), {
  api: {
    ...fakeMachinesApi,
    dockerContainerLogs: async () => ({
      text: Array.from(
        { length: 500 },
        (_, line) =>
          `2026-11-16T19:${String(Math.floor(line / 60) + 30).padStart(2, '0')}:${String(line % 60).padStart(2, '0')}.118Z LOG:  checkpoint ${line}: wrote ${line * 13} buffers; write=28.9 s, sync=0.4 s, total=29.6 s; distance=41213 kB\n`
      ).join(''),
      truncated: true,
      collectedAt: Date.now()
    })
  }
})

export const image = sheet(JUPYTER_IMAGE)

export const imageNarrow = sheet(JUPYTER_IMAGE, { narrow: true })

export const imageUntagged = sheet({
  kind: 'image',
  id: FAKE_DOCKER_IMAGES.find((entry) => entry.reference === null)?.id ?? ''
})

export const containerFromImage = sheet(JUPYTER_IMAGE, {
  afterOpen: (page) => press(page, 'jupyter')
})

export const volume = sheet(PGDATA)

export const volumeFile = sheet(PGDATA, {
  afterOpen: (page) => pressFile(page, 'postgresql.conf'),
  settleMs: PREVIEW_SETTLE_MS
})

export const volumeFileNarrow = sheet(PGDATA, {
  narrow: true,
  afterOpen: (page) => pressFile(page, 'postgresql.conf'),
  settleMs: PREVIEW_SETTLE_MS
})

export const volumeFolderOpen = sheet(PGDATA, { afterOpen: (page) => pressFile(page, 'base') })

export const volumeLargeFolder = sheet(PGDATA, {
  api: {
    ...fakeMachinesApi,
    dockerVolumeListDir: async (args) => {
      const listing = await fakeMachinesApi.dockerVolumeListDir(args)
      return { ...listing, totalEntries: listing.entries.length + 4_200 }
    }
  }
})

export const volumeUnreadable = sheet(
  { kind: 'volume', id: FAKE_DOCKER_VOLUMES.find((entry) => entry.driver === 'nfs')?.name ?? '' },
  {
    api: {
      ...fakeMachinesApi,
      dockerVolumeListDir: async () => {
        throw new Error(
          'Reading this volume needs root on kessel-ml, or an image to mount it into. Neither is available.'
        )
      }
    }
  }
)

export const gone = sheet(stored('postgres'), {
  api: {
    ...fakeMachinesApi,
    dockerDetails: async () => {
      throw new Error('No such container: 1c2d3e4f5a6b')
    }
  }
})
