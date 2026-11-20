import {
  MACHINE_DIR_PAGE_SIZE,
  type MachineDirListing,
  type MachineFileEntry,
  type MachineId
} from '../../../shared/machines/machine-types'
import { joinMachinePath } from '../../../shared/machines/machine-paths'
import { sortDirEntries } from '../../../shared/file-listing/file-name-sort'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'

type CachedListing = { entries: MachineFileEntry[]; listedAt: number; signature: string }

export type MachineDirectoryServiceOptions = {
  resolveFileSystem: (machineId: MachineId) => MachineFileSystem
  onDirChanged: (machineId: MachineId, path: string) => void
  now?: () => number
  /** Cached listings older than this revalidate in the background when read. */
  staleAfterMs?: number
  maxCachedDirs?: number
  /** Child folders prefetched after each fresh listing. */
  prefetchChildren?: number
  pollIntervalMs?: number
  /** Safety re-list even while a native watcher runs, since remote feeds can silently die. */
  nativeWatchPollIntervalMs?: number
  maxWatchedDirs?: number
}

type MachineWatch = {
  dirs: string[]
  stopNative: (() => void) | null
  timer: ReturnType<typeof setTimeout> | null
  generation: number
}

export function listingSignature(entries: MachineFileEntry[]): string {
  return entries.map((e) => `${e.name}\0${e.kind}\0${e.size}\0${e.mtimeMs}`).join('\n')
}

function sortEntries(entries: MachineFileEntry[]): MachineFileEntry[] {
  return sortDirEntries(
    entries.map((entry) => ({ ...entry, isDirectory: entry.isDirectoryLike }))
  ).map(({ isDirectory: _isDirectory, ...entry }) => entry)
}

/** Cache-first listings with background revalidation, child prefetch and change watching. */
export class MachineDirectoryService {
  private readonly cache = new Map<string, CachedListing>()
  private readonly inflight = new Map<string, Promise<CachedListing>>()
  private readonly watches = new Map<MachineId, MachineWatch>()
  private readonly prefetchQueue: { machineId: MachineId; path: string }[] = []
  private prefetching = 0
  private readonly options: Required<Omit<MachineDirectoryServiceOptions, 'now'>> & {
    now: () => number
  }

  constructor(options: MachineDirectoryServiceOptions) {
    this.options = {
      now: Date.now,
      staleAfterMs: 5_000,
      maxCachedDirs: 2_000,
      prefetchChildren: 24,
      pollIntervalMs: 4_000,
      nativeWatchPollIntervalMs: 30_000,
      maxWatchedDirs: 64,
      ...options
    }
  }

  private key(machineId: MachineId, path: string): string {
    return `${machineId}\0${path}`
  }

  private remember(key: string, listing: CachedListing): void {
    this.cache.delete(key)
    this.cache.set(key, listing)
    while (this.cache.size > this.options.maxCachedDirs) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.cache.delete(oldest)
    }
  }

  private fetch(machineId: MachineId, path: string): Promise<CachedListing> {
    const key = this.key(machineId, path)
    const existing = this.inflight.get(key)
    if (existing) {
      return existing
    }
    const request = this.options
      .resolveFileSystem(machineId)
      .listDir(path)
      .then((entries) => {
        const sorted = sortEntries(entries)
        const listing = {
          entries: sorted,
          listedAt: this.options.now(),
          signature: listingSignature(sorted)
        }
        const previous = this.cache.get(key)
        this.remember(key, listing)
        if (previous && previous.signature !== listing.signature) {
          this.options.onDirChanged(machineId, path)
        }
        return listing
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, request)
    return request
  }

  async listDir(
    machineId: MachineId,
    path: string,
    options: { force?: boolean; offset?: number } = {}
  ): Promise<MachineDirListing> {
    const key = this.key(machineId, path)
    const cached = options.force ? undefined : this.cache.get(key)
    let listing: CachedListing
    let fromCache = false
    if (cached) {
      listing = cached
      fromCache = true
      this.cache.delete(key)
      this.cache.set(key, cached)
      if (this.options.now() - cached.listedAt > this.options.staleAfterMs) {
        void this.fetch(machineId, path).catch(() => {})
      }
    } else {
      listing = await this.fetch(machineId, path)
      this.schedulePrefetch(machineId, path, listing.entries)
    }
    const offset = Math.max(0, options.offset ?? 0)
    return {
      machineId,
      path,
      entries: listing.entries.slice(offset, offset + MACHINE_DIR_PAGE_SIZE),
      totalEntries: listing.entries.length,
      offset,
      listedAt: listing.listedAt,
      fromCache
    }
  }

  /** Drops a folder's listing after a local mutation and tells the renderer to re-read it. */
  invalidate(machineId: MachineId, path: string): void {
    this.cache.delete(this.key(machineId, path))
    this.options.onDirChanged(machineId, path)
  }

  forgetMachine(machineId: MachineId): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${machineId}\0`)) {
        this.cache.delete(key)
      }
    }
    this.stopWatch(machineId)
  }

  private schedulePrefetch(machineId: MachineId, path: string, entries: MachineFileEntry[]): void {
    const children = entries
      .filter((entry) => entry.isDirectoryLike && !entry.name.startsWith('.'))
      .slice(0, this.options.prefetchChildren)
    for (const child of children) {
      const childPath = joinMachinePath(path, child.name)
      if (!this.cache.has(this.key(machineId, childPath))) {
        this.prefetchQueue.push({ machineId, path: childPath })
      }
    }
    this.pumpPrefetch()
  }

  private pumpPrefetch(): void {
    // Two background listings at a time keeps prefetch from starving foreground requests.
    while (this.prefetching < 2 && this.prefetchQueue.length > 0) {
      const next = this.prefetchQueue.shift()!
      if (this.cache.has(this.key(next.machineId, next.path))) {
        continue
      }
      this.prefetching += 1
      void this.fetch(next.machineId, next.path)
        .catch(() => {})
        .finally(() => {
          this.prefetching -= 1
          this.pumpPrefetch()
        })
    }
  }

  /** Replaces the folders watched on a machine (the explorer's expanded folders). */
  async watchDirs(machineId: MachineId, dirs: string[]): Promise<void> {
    const unique = [...new Set(dirs)].slice(0, this.options.maxWatchedDirs)
    const current = this.watches.get(machineId)
    if (current && current.dirs.join('\n') === unique.join('\n')) {
      return
    }
    this.stopWatch(machineId)
    if (unique.length === 0) {
      return
    }
    const watch: MachineWatch = {
      dirs: unique,
      stopNative: null,
      timer: null,
      generation: (current?.generation ?? 0) + 1
    }
    this.watches.set(machineId, watch)
    const relist = (dir: string): void => {
      void this.fetch(machineId, dir).catch(() => {})
    }
    const relistChanged = async (dir: string): Promise<boolean> => {
      const before = this.cache.get(this.key(machineId, dir))?.signature
      const after = await this.fetch(machineId, dir).then(
        (listing) => listing.signature,
        () => before
      )
      return before !== undefined && before !== after
    }
    const pending = new Map<string, ReturnType<typeof setTimeout>>()
    // Change feeds fire per file during bulk copies; one re-list per burst is enough.
    const relistSoon = (dir: string): void => {
      if (pending.has(dir) || this.watches.get(machineId) !== watch) {
        return
      }
      pending.set(
        dir,
        setTimeout(() => {
          pending.delete(dir)
          relist(dir)
        }, 250)
      )
    }
    const stopNative = await this.options
      .resolveFileSystem(machineId)
      .watch(unique, relistSoon)
      .catch(() => null)
    if (this.watches.get(machineId) !== watch) {
      stopNative?.()
      return
    }
    watch.stopNative = stopNative
    const baseDelay = stopNative
      ? this.options.nativeWatchPollIntervalMs
      : this.options.pollIntervalMs
    // Quiet folders back off up to 8x; any change snaps back to the base cadence.
    let delay = baseDelay
    const schedule = (): void => {
      watch.timer = setTimeout(() => {
        void Promise.all(watch.dirs.map(relistChanged)).then((changes) => {
          if (this.watches.get(machineId) !== watch) {
            return
          }
          delay = changes.some(Boolean) ? baseDelay : Math.min(delay * 2, baseDelay * 8)
          schedule()
        })
      }, delay)
      watch.timer.unref?.()
    }
    schedule()
  }

  stopWatch(machineId: MachineId): void {
    const watch = this.watches.get(machineId)
    if (!watch) {
      return
    }
    this.watches.delete(machineId)
    watch.stopNative?.()
    if (watch.timer) {
      clearTimeout(watch.timer)
    }
  }

  dispose(): void {
    for (const machineId of this.watches.keys()) {
      this.stopWatch(machineId)
    }
    this.cache.clear()
  }
}
