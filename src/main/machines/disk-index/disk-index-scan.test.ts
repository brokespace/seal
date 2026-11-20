import { lstat, mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readDiskIndex } from './disk-index-file'
import { NODE_STUB, type DiskIndex } from './disk-index-layout'
import { findDiskIndexNode } from './disk-index-query'
import { runDiskScan, type DiskScanHost, type DiskScanPlan } from './disk-index-scan'
import type { WalkFs, WalkStat, WalkerMessage } from './disk-index-walk-protocol'
import { DiskWalker } from './disk-index-walker'

const OLD_SECONDS = 1_600_000_000
const OTHER_DISK = 987_654
const MIB_IN_BLOCKS = 2048

type FakeEntry = {
  ino: number
  dev: number
  mtimeMs: number
  blocks: number
  nlink: number
  /** Names inside a folder; undefined for a file. */
  children?: string[]
  unreadable?: boolean
}

/** A filesystem held in memory, so sizes and link counts are exact on every platform. */
class FakeTree {
  private readonly entries = new Map<string, FakeEntry>()
  private nextIno = 1000

  constructor(
    private readonly root: string,
    private readonly dev: number
  ) {}

  readonly fs: WalkFs = {
    readdir: (path) => {
      const entry = path === this.root ? this.rootEntry : this.entries.get(path)
      if (!entry?.children) {
        throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      }
      if (entry.unreadable) {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      }
      return entry.children
    },
    lstat: (path): WalkStat | undefined => {
      const entry = this.entries.get(path)
      return entry && { ...entry, isDirectory: () => entry.children !== undefined }
    }
  }

  private readonly rootEntry: FakeEntry = {
    ino: 1,
    dev: 0,
    mtimeMs: 0,
    blocks: 0,
    nlink: 1,
    children: []
  }

  private add(path: string, entry: FakeEntry): void {
    const at = path.lastIndexOf('/')
    const parent = at === 0 ? this.rootEntry : this.entries.get(this.root + path.slice(0, at))
    parent!.children!.push(path.slice(at + 1))
    parent!.mtimeMs += 1000
    this.entries.set(this.root + path, entry)
  }

  folder(path: string, overrides: Partial<FakeEntry> = {}): void {
    this.add(path, {
      ino: this.nextIno++,
      dev: this.dev,
      mtimeMs: OLD_SECONDS * 1000,
      blocks: 0,
      nlink: 1,
      children: [],
      ...overrides
    })
  }

  file(path: string, blocks: number, overrides: Partial<FakeEntry> = {}): void {
    this.add(path, {
      ino: this.nextIno++,
      dev: this.dev,
      mtimeMs: OLD_SECONDS * 1000,
      blocks,
      nlink: 1,
      ...overrides
    })
  }

  removeFolder(path: string): void {
    const at = path.lastIndexOf('/')
    const parent = at === 0 ? this.rootEntry : this.entries.get(this.root + path.slice(0, at))!
    parent.children = parent.children!.filter((name) => name !== path.slice(at + 1))
    parent.mtimeMs += 1000
    for (const key of this.entries.keys()) {
      if (key === this.root + path || key.startsWith(`${this.root}${path}/`)) {
        this.entries.delete(key)
      }
    }
  }
}

/** Walkers on this thread: the same code the daemon runs on worker threads. */
function inProcessHost(fs: WalkFs): DiskScanHost {
  return {
    createWalker: (init) => {
      let deliver: (message: WalkerMessage) => void = () => {}
      const walker = new DiskWalker(fs, init, (message) => queueMicrotask(() => deliver(message)))
      return {
        post: (command) => queueMicrotask(() => walker.handle(command)),
        listen: (onMessage) => {
          deliver = onMessage
        },
        close: () => {}
      }
    }
  }
}

describe('runDiskScan', () => {
  let root: string
  let dataDir: string
  let tree: FakeTree
  let plan: DiskScanPlan

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'seal-disk-index-root-'))
    dataDir = await mkdtemp(join(tmpdir(), 'seal-disk-index-data-'))
    // The real root must not look freshly modified, or every scan re-reads it.
    await utimes(root, OLD_SECONDS, OLD_SECONDS)
    tree = new FakeTree(root, (await lstat(root)).dev)
    plan = {
      root,
      indexPath: join(dataDir, 'index.sdix'),
      sameDiskPaths: [],
      anyDev: false,
      stops: [],
      walkers: 3,
      hotWindowMs: 60_000,
      full: false
    }
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(dataDir, { recursive: true, force: true })
  })

  async function scan(): Promise<DiskIndex> {
    await runDiskScan(plan, inProcessHost(tree.fs))
    return (await readDiskIndex(plan.indexPath, false))!
  }

  function bytesOf(index: DiskIndex, path: string): number {
    return index.totalBytes[findDiskIndexNode(index, root + path)]
  }

  it('counts hard-linked data once and stays out of other filesystems', async () => {
    tree.folder('/a')
    tree.file('/a/data.bin', MIB_IN_BLOCKS, { ino: 77, nlink: 2 })
    tree.folder('/b')
    tree.file('/b/data-link.bin', MIB_IN_BLOCKS, { ino: 77, nlink: 2 })
    tree.file('/b/notes.txt', 8)
    tree.folder('/mnt', { dev: OTHER_DISK })
    tree.file('/mnt/huge.bin', 500 * MIB_IN_BLOCKS, { dev: OTHER_DISK })
    tree.folder('/skipped')
    tree.file('/skipped/cache.bin', 300 * MIB_IN_BLOCKS)
    tree.folder('/locked', { unreadable: true })
    plan.stops = [`${root}/skipped`]

    const index = await scan()

    expect(bytesOf(index, '/a') + bytesOf(index, '/b')).toBe(1_052_672)
    expect(bytesOf(index, '/mnt')).toBe(0)
    expect(index.flags[findDiskIndexNode(index, `${root}/mnt`)] & NODE_STUB).toBe(NODE_STUB)
    expect(bytesOf(index, '/skipped')).toBe(0)
    expect(index.summary.totalFiles).toBe(3)
    expect(index.summary.unreadableFolders).toBe(1)
  })

  it('picks up added and removed folders on an incremental rescan', async () => {
    tree.folder('/src')
    tree.file('/src/main.ts', 8)
    tree.folder('/src/deep')
    tree.file('/src/deep/lib.ts', 16)
    tree.folder('/media')
    tree.file('/media/film.mov', MIB_IN_BLOCKS)
    tree.folder('/media/raw')
    tree.file('/media/raw/take-1.mov', 2 * MIB_IN_BLOCKS)
    tree.folder('/old')
    tree.file('/old/backup.tar', 4 * MIB_IN_BLOCKS)

    const first = await scan()
    expect(first.summary.mode).toBe('full')
    expect(bytesOf(first, '/src')).toBe(12_288)
    expect(bytesOf(first, '/media')).toBe(3_145_728)
    expect(bytesOf(first, '/old')).toBe(4_194_304)

    tree.file('/src/deep/generated.ts', 32)
    tree.folder('/media/raw/proxies')
    tree.file('/media/raw/proxies/take-1.mp4', 64)
    tree.removeFolder('/old')
    await utimes(root, OLD_SECONDS + 60, OLD_SECONDS + 60)

    const second = await scan()
    expect(second.summary.mode).toBe('incremental')
    expect(bytesOf(second, '/src')).toBe(28_672)
    expect(bytesOf(second, '/media')).toBe(3_178_496)
    expect(findDiskIndexNode(second, `${root}/old`)).toBe(-1)
    expect(second.summary.totalFiles).toBe(6)
  })
})
