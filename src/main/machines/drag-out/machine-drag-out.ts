import { mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { MachineId } from '../../../shared/machines/machine-types'
import { machinePathBasename } from '../../../shared/machines/machine-paths'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'

/** Drag-out has to start while the pointer is still down, so only small files are staged. */
export const MACHINE_DRAG_OUT_MAX_BYTES = 256 * 1024 * 1024
const MAX_STAGED = 32

/** Stages remote files on local disk before a drag needs them; the OS can only drag local paths. */
export class MachineDragOutStager {
  private readonly staged = new Map<string, Promise<string>>()
  private readonly root = path.join(os.tmpdir(), `seal-machine-drag-${process.pid}`)

  constructor(private readonly resolveFileSystem: (machineId: MachineId) => MachineFileSystem) {}

  stage(machineId: MachineId, remotePath: string, size: number): Promise<string> {
    const key = `${machineId}\0${remotePath}`
    const existing = this.staged.get(key)
    if (existing) {
      return existing
    }
    if (size > MACHINE_DRAG_OUT_MAX_BYTES) {
      return Promise.reject(new Error('File is too large to drag out; use Download instead'))
    }
    const job = (async () => {
      const dir = path.join(this.root, randomUUID())
      await mkdir(dir, { recursive: true })
      const local = path.join(dir, machinePathBasename(remotePath))
      const fs = this.resolveFileSystem(machineId)
      const session = await fs.openTransferSession(new AbortController().signal)
      try {
        await session.downloadFile(remotePath, local, size, () => {})
      } finally {
        session.close()
      }
      return local
    })()
    job.catch(() => this.staged.delete(key))
    this.staged.set(key, job)
    while (this.staged.size > MAX_STAGED) {
      const oldest = this.staged.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.staged.delete(oldest)
    }
    return job
  }

  async dispose(): Promise<void> {
    this.staged.clear()
    await rm(this.root, { recursive: true, force: true }).catch(() => {})
  }
}
