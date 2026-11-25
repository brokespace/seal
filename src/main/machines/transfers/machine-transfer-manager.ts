import { mkdir, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MachineId, MachineTransfer } from '../../../shared/machines/machine-types'
import { joinMachinePath } from '../../../shared/machines/machine-paths'
import {
  fileNameFromUrl,
  isAllowedDownloadUrl,
  type MachineFileSystem,
  type MachineTransferSession
} from '../filesystem/machine-filesystem'
import {
  assignTopLevelNames,
  joinSegments,
  planLocalTree,
  planMachineTree,
  sourceBasename,
  type TransferPlan
} from './machine-transfer-plan'

const PARALLEL_FILES = 4
const UPDATE_THROTTLE_MS = 150
const MAX_RETAINED_FINISHED = 50

export type MachineTransferManagerOptions = {
  resolveFileSystem: (machineId: MachineId) => MachineFileSystem
  onUpdate: (transfer: MachineTransfer) => void
  /** A remote folder's contents changed because of a transfer. */
  onRemoteDirChanged: (machineId: MachineId, dir: string) => void
  now?: () => number
}

type ActiveTransfer = {
  transfer: MachineTransfer
  controller: AbortController
  lastEmit: number
  pendingEmit: ReturnType<typeof setTimeout> | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runInParallel<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]
      next += 1
      await worker(item)
    }
  })
  await Promise.all(lanes)
}

export class MachineTransferManager {
  private readonly transfers = new Map<string, ActiveTransfer>()
  private readonly now: () => number

  constructor(private readonly options: MachineTransferManagerOptions) {
    this.now = options.now ?? Date.now
  }

  list(): MachineTransfer[] {
    return [...this.transfers.values()].map((active) => ({ ...active.transfer }))
  }

  cancel(id: string): void {
    this.transfers.get(id)?.controller.abort()
  }

  clearFinished(): void {
    for (const [id, active] of this.transfers) {
      if (active.transfer.status !== 'running') {
        this.transfers.delete(id)
      }
    }
  }

  private begin(
    machineId: MachineId,
    direction: MachineTransfer['direction'],
    label: string,
    destination: string
  ): ActiveTransfer {
    const active: ActiveTransfer = {
      transfer: {
        id: randomUUID(),
        machineId,
        direction,
        label,
        destination,
        totalBytes: null,
        transferredBytes: 0,
        filesTotal: 0,
        filesDone: 0,
        status: 'running',
        error: null,
        startedAt: this.now(),
        finishedAt: null
      },
      controller: new AbortController(),
      lastEmit: 0,
      pendingEmit: null
    }
    this.transfers.set(active.transfer.id, active)
    this.trimFinished()
    this.emit(active, true)
    return active
  }

  private trimFinished(): void {
    const finished = [...this.transfers.values()].filter((t) => t.transfer.status !== 'running')
    for (const stale of finished.slice(0, Math.max(0, finished.length - MAX_RETAINED_FINISHED))) {
      this.transfers.delete(stale.transfer.id)
    }
  }

  private emit(active: ActiveTransfer, immediate = false): void {
    const send = (): void => {
      active.pendingEmit = null
      active.lastEmit = this.now()
      this.options.onUpdate({ ...active.transfer })
    }
    if (immediate || this.now() - active.lastEmit >= UPDATE_THROTTLE_MS) {
      if (active.pendingEmit) {
        clearTimeout(active.pendingEmit)
      }
      send()
    } else if (!active.pendingEmit) {
      active.pendingEmit = setTimeout(send, UPDATE_THROTTLE_MS)
    }
  }

  private async run(active: ActiveTransfer, job: () => Promise<void>): Promise<void> {
    try {
      await job()
      active.transfer.status = active.controller.signal.aborted ? 'cancelled' : 'done'
    } catch (error) {
      active.transfer.status = active.controller.signal.aborted ? 'cancelled' : 'failed'
      active.transfer.error = active.transfer.status === 'failed' ? errorMessage(error) : null
    }
    active.transfer.finishedAt = this.now()
    this.emit(active, true)
  }

  private progress(active: ActiveTransfer) {
    return (delta: number): void => {
      active.transfer.transferredBytes += delta
      this.emit(active)
    }
  }

  private async copyPlan(
    active: ActiveTransfer,
    plan: TransferPlan,
    session: MachineTransferSession,
    createDir: (segments: string[]) => Promise<void>,
    copyFile: (
      session: MachineTransferSession,
      file: TransferPlan['files'][number]
    ) => Promise<void>
  ): Promise<void> {
    active.transfer.totalBytes = plan.totalBytes
    active.transfer.filesTotal = plan.files.length
    this.emit(active, true)
    for (const segments of plan.dirs) {
      await createDir(segments)
    }
    await runInParallel(plan.files, PARALLEL_FILES, async (file) => {
      if (active.controller.signal.aborted) {
        throw new Error('Transfer cancelled')
      }
      await copyFile(session, file)
      active.transfer.filesDone += 1
      this.emit(active)
    })
  }

  /** Uploads local files/folders into `destDir` on the machine. */
  upload(machineId: MachineId, localPaths: string[], destDir: string): MachineTransfer {
    const label =
      localPaths.length === 1 ? sourceBasename(localPaths[0]) : `${localPaths.length} items`
    const active = this.begin(machineId, 'upload', label, destDir)
    void this.run(active, async () => {
      const fs = this.options.resolveFileSystem(machineId)
      const signal = active.controller.signal
      const existing = await fs.listDir(destDir).then(
        (entries) => entries.map((entry) => entry.name),
        () => []
      )
      const names = assignTopLevelNames(localPaths.map(sourceBasename), existing)
      const plan = await planLocalTree(localPaths, names, signal)
      const session = await fs.openTransferSession(signal)
      try {
        await this.copyPlan(
          active,
          plan,
          session,
          (segments) => fs.createDir(joinSegments(destDir, segments)),
          (s, file) =>
            s.uploadFile(
              file.source,
              joinSegments(destDir, file.segments),
              file.size,
              this.progress(active)
            )
        )
      } finally {
        session.close()
        this.options.onRemoteDirChanged(machineId, destDir)
      }
    })
    return { ...active.transfer }
  }

  /** Downloads machine files/folders into a local folder. */
  download(machineId: MachineId, remotePaths: string[], localDir: string): MachineTransfer {
    const label =
      remotePaths.length === 1 ? sourceBasename(remotePaths[0]) : `${remotePaths.length} items`
    const active = this.begin(machineId, 'download', label, localDir)
    void this.run(active, async () => {
      const fs = this.options.resolveFileSystem(machineId)
      const signal = active.controller.signal
      const existing = await readdir(localDir).catch(() => [])
      const names = assignTopLevelNames(remotePaths.map(sourceBasename), existing)
      const plan = await planMachineTree(fs, remotePaths, names, signal)
      const session = await fs.openTransferSession(signal)
      try {
        await this.copyPlan(
          active,
          plan,
          session,
          async (segments) => {
            await mkdir(path.join(localDir, ...segments), { recursive: true })
          },
          (s, file) =>
            s.downloadFile(
              file.source,
              path.join(localDir, ...file.segments),
              file.size,
              this.progress(active)
            )
        )
      } finally {
        session.close()
      }
    })
    return { ...active.transfer }
  }

  /** Has the machine itself fetch `url` into `destDir`, so bytes never pass through this desktop. */
  downloadUrl(
    machineId: MachineId,
    url: string,
    destDir: string,
    fileName?: string
  ): MachineTransfer {
    if (!isAllowedDownloadUrl(url)) {
      throw new Error('Only http and https URLs can be downloaded')
    }
    const requested = fileName?.trim() || fileNameFromUrl(url)
    const active = this.begin(machineId, 'url-download', requested, destDir)
    active.transfer.filesTotal = 1
    void this.run(active, async () => {
      const fs = this.options.resolveFileSystem(machineId)
      const existing = await fs.listDir(destDir).then(
        (entries) => entries.map((entry) => entry.name),
        () => []
      )
      const [name] = assignTopLevelNames([requested], existing)
      active.transfer.label = name
      try {
        await fs.downloadUrl(
          url,
          joinMachinePath(destDir, name),
          (transferred, total) => {
            active.transfer.transferredBytes = transferred
            active.transfer.totalBytes = total
            this.emit(active)
          },
          active.controller.signal
        )
        active.transfer.filesDone = 1
      } finally {
        this.options.onRemoteDirChanged(machineId, destDir)
      }
    })
    return { ...active.transfer }
  }

  dispose(): void {
    for (const active of this.transfers.values()) {
      active.controller.abort()
    }
  }
}
