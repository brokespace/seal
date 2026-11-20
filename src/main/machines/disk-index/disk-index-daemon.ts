import { chmod, mkdir, rm } from 'node:fs/promises'
import { diskMountOfPath } from '../../../shared/machines/machine-disk-mount-rules'
import {
  DISK_INDEX_PROTOCOL,
  type MachineDiskIndexRequest,
  type MachineDiskIndexStatus
} from '../../../shared/machines/machine-disk-index-types'
import {
  diskIndexMountStatus,
  diskIndexSkipReason,
  loadDiskIndexConfig,
  saveDiskIndexConfig,
  setDiskIndexed,
  type DiskIndexConfig
} from './disk-index-config'
import { diskIndexFilePath, readDiskIndex, readDiskIndexSummary } from './disk-index-file'
import type { DiskIndex, DiskIndexSummary } from './disk-index-layout'
import { discoverDiskIndexRoots, type DiskIndexRoot } from './disk-index-mounts'
import {
  largestDiskIndexFiles,
  largestDiskIndexFolders,
  listDiskIndexFolder
} from './disk-index-query'
import type { DiskScanPlan } from './disk-index-scan'
import {
  createScanProgress,
  readScanProgress,
  type ScanProgressCounters
} from './disk-index-scan-progress'
import type { DiskIndexDaemonReply, DiskIndexEnvelope } from './disk-index-socket'
import { errnoCodeOrUnknown } from '../../../shared/errno-code'

const TICK_MS = 30_000
const ROOTS_FRESH_MS = 5000
const LOADED_INDEX_KEPT_MS = 90_000
/** A slow disk is rescanned less often, so scanning never becomes most of what the machine does. */
const SCAN_BACKOFF_FACTOR = 10

export type DiskIndexDaemonOptions = {
  dataDir: string
  /** False once another daemon has taken over the socket. */
  stillOwnsSocket(): Promise<boolean>
  /** The daemon stops when this process is gone. */
  ownerPid: number | null
  /** The daemon stops after this long without a request. */
  idleExitMs: number | null
  walkers: number
  intervalMs: number
  fullIntervalMs: number
  hotWindowMs: number
  runScan(plan: DiskScanPlan, progress: ScanProgressCounters): Promise<DiskIndexSummary>
  exit(): void
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errnoCodeOrUnknown(error) === 'EPERM'
  }
}

export class DiskIndexDaemon {
  private roots: DiskIndexRoot[] = []
  private rootsReadAt = 0
  private readonly summaries = new Map<string, DiskIndexSummary>()
  private readonly summaryLoaded = new Set<string>()
  private readonly retryAt = new Map<string, number>()
  private config: DiskIndexConfig = { include: [], exclude: [], includeProtected: false }
  private scan: { mount: string; startedAt: number; progress: ScanProgressCounters } | null = null
  private queue: { mount: string; full: boolean }[] = []
  private roundMs = 0
  private generation = 0
  private nextScanAt = 0
  private rescanRequested = false
  private lastRequestAt = Date.now()
  private loaded: { mount: string; generation: number; index: DiskIndex } | null = null
  private loadedTimer: NodeJS.Timeout | undefined
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly options: DiskIndexDaemonOptions) {}

  async start(): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true, mode: 0o700 })
    // Folder names are private; whoever copied the program here may have made the folder readable.
    await chmod(this.options.dataDir, 0o700).catch(() => {})
    this.config = await loadDiskIndexConfig(this.options.dataDir)
    await this.refreshRoots(true)
    const scanned = this.indexedRoots().flatMap(
      (root) => this.summaries.get(root.mount)?.scannedAt ?? []
    )
    this.nextScanAt = scanned.length > 0 ? Math.min(...scanned) + this.options.intervalMs : 0
    this.schedule(0)
  }

  async handle(envelope: DiskIndexEnvelope): Promise<DiskIndexDaemonReply> {
    this.lastRequestAt = Date.now()
    // Several Seal builds share one machine (a desktop, its server, a phone), so only a newer protocol takes over.
    if (envelope.protocol > DISK_INDEX_PROTOCOL) {
      setTimeout(() => this.options.exit(), 50)
      return { ok: false, superseded: true }
    }
    const request: MachineDiskIndexRequest = envelope.request
    switch (request.op) {
      case 'list': {
        if (!request.path.startsWith('/')) {
          return { ok: false, message: 'An absolute folder path is required' }
        }
        await this.refreshRoots(false)
        const root = diskMountOfPath(this.roots, request.path)
        const index = root && this.isIndexed(root) ? await this.loadIndex(root.mount) : null
        return { ok: true, listing: await listDiskIndexFolder(index, request.path) }
      }
      case 'largest': {
        const index = await this.loadIndex(request.mount)
        const empty = { kind: request.kind, items: [], scannedAt: null }
        if (!index) {
          return { ok: true, largest: empty }
        }
        return {
          ok: true,
          largest:
            request.kind === 'files' ? largestDiskIndexFiles(index) : largestDiskIndexFolders(index)
        }
      }
      case 'setMountIndexed':
        await this.setMountIndexed(request.mount, request.indexed)
        break
      case 'setProtectedFolders':
        this.config.includeProtected = request.included
        await this.saveConfig()
        await this.refreshRoots(true)
        this.rescanRequested = true
        break
      case 'rescan':
        this.rescanRequested = true
        break
      case 'status':
        break
    }
    if (request.op !== 'status') {
      this.schedule(0)
    }
    await this.refreshRoots(false)
    return { ok: true, status: this.status() }
  }

  private saveConfig(): Promise<void> {
    return saveDiskIndexConfig(this.options.dataDir, this.config)
  }

  private isIndexed(root: DiskIndexRoot): boolean {
    return diskIndexSkipReason(this.config, root) === null
  }

  private indexedRoots(): DiskIndexRoot[] {
    return this.roots.filter((root) => this.isIndexed(root))
  }

  private async setMountIndexed(mount: string, indexed: boolean): Promise<void> {
    const root = this.roots.find((candidate) => candidate.mount === mount)
    if (!root) {
      throw new Error('That disk is no longer attached to this machine.')
    }
    setDiskIndexed(this.config, root, indexed)
    await this.saveConfig()
    if (!indexed) {
      this.summaries.delete(mount)
      this.loaded = null
      this.generation += 1
      await rm(diskIndexFilePath(this.options.dataDir, mount), { force: true })
    }
  }

  private async refreshRoots(force: boolean): Promise<void> {
    if (!force && Date.now() - this.rootsReadAt < ROOTS_FRESH_MS) {
      return
    }
    this.roots = await discoverDiskIndexRoots(this.config.includeProtected)
    this.rootsReadAt = Date.now()
    for (const root of this.roots) {
      if (!this.summaryLoaded.has(root.mount)) {
        this.summaryLoaded.add(root.mount)
        const summary = await readDiskIndexSummary(
          diskIndexFilePath(this.options.dataDir, root.mount)
        )
        if (summary?.root === root.mount) {
          this.summaries.set(root.mount, summary)
        }
      }
    }
  }

  private async loadIndex(mount: string): Promise<DiskIndex | null> {
    if (!this.summaries.has(mount)) {
      return null
    }
    if (this.loaded?.mount !== mount || this.loaded.generation !== this.generation) {
      const index = await readDiskIndex(diskIndexFilePath(this.options.dataDir, mount), false)
      this.loaded = index ? { mount, generation: this.generation, index } : null
    }
    clearTimeout(this.loadedTimer)
    // A large index is tens of megabytes; it is only worth holding while someone is browsing.
    this.loadedTimer = setTimeout(() => {
      this.loaded = null
    }, LOADED_INDEX_KEPT_MS)
    return this.loaded?.index ?? null
  }

  private status(): MachineDiskIndexStatus {
    const scan = this.scan
    return {
      source: 'index',
      unavailableReason: null,
      mounts: this.roots.map((root) =>
        diskIndexMountStatus(this.config, root, this.summaries.get(root.mount))
      ),
      scan: scan ? readScanProgress(scan.progress, scan.mount, scan.startedAt) : null,
      nextScanAt: this.scan || this.queue.length > 0 ? null : this.nextScanAt,
      now: Date.now(),
      generation: this.generation,
      protectedFoldersSkipped: process.platform === 'darwin' && !this.config.includeProtected
    }
  }

  private schedule(delayMs: number): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), delayMs)
  }

  private async tick(): Promise<void> {
    const { ownerPid, idleExitMs } = this.options
    if (
      (ownerPid !== null && !isRunning(ownerPid)) ||
      (idleExitMs !== null && Date.now() - this.lastRequestAt > idleExitMs) ||
      !(await this.options.stillOwnsSocket())
    ) {
      this.options.exit()
      return
    }
    this.schedule(TICK_MS)
    if (this.scan) {
      return
    }
    await this.refreshRoots(false).catch(() => {})
    if (this.queue.length === 0) {
      this.planDueScans()
    }
    const next = this.queue.shift()
    const root = next && this.indexedRoots().find((candidate) => candidate.mount === next.mount)
    if (next && root) {
      await this.runScan(root, next.full)
    }
  }

  private planDueScans(): void {
    const now = Date.now()
    const due = this.rescanRequested || now >= this.nextScanAt
    for (const root of this.indexedRoots()) {
      const summary = this.summaries.get(root.mount)
      if (!summary) {
        if ((this.retryAt.get(root.mount) ?? 0) <= now) {
          this.queue.push({ mount: root.mount, full: true })
        }
      } else if (due) {
        this.queue.push({
          mount: root.mount,
          full: now - summary.lastFullAt >= this.options.fullIntervalMs
        })
      }
    }
    if (due) {
      this.rescanRequested = false
      this.nextScanAt = now + this.options.intervalMs
    }
  }

  private async runScan(root: DiskIndexRoot, full: boolean): Promise<void> {
    const progress = createScanProgress()
    this.scan = { mount: root.mount, startedAt: Date.now(), progress }
    try {
      const summary = await this.options.runScan(
        {
          root: root.mount,
          indexPath: diskIndexFilePath(this.options.dataDir, root.mount),
          sameDiskPaths: root.sameDiskPaths,
          anyDev: root.anyDev,
          stops: root.stops,
          walkers: this.options.walkers,
          hotWindowMs: this.options.hotWindowMs,
          full
        },
        progress
      )
      this.summaries.set(root.mount, summary)
      this.generation += 1
      this.roundMs += summary.durationMs
    } catch (error) {
      console.error(`[disk-index] scan of ${root.mount} failed:`, error)
      this.retryAt.set(root.mount, Date.now() + this.options.intervalMs)
    } finally {
      this.scan = null
    }
    if (this.queue.length === 0) {
      this.nextScanAt =
        Date.now() + Math.max(this.options.intervalMs, this.roundMs * SCAN_BACKOFF_FACTOR)
      this.roundMs = 0
    }
    this.schedule(0)
  }
}
