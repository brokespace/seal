import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MachineFileEntry, MachineId } from '../../../shared/machines/machine-types'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'
import { MachineDirectoryService } from './machine-directory-service'

const MACHINE: MachineId = 'machine:box'

function file(name: string, size = 1): MachineFileEntry {
  return { name, kind: 'file', isDirectoryLike: false, size, mtimeMs: 0 }
}

function folder(name: string): MachineFileEntry {
  return { name, kind: 'directory', isDirectoryLike: true, size: 0, mtimeMs: 0 }
}

function fakeFileSystem(tree: Record<string, MachineFileEntry[]>, watch: 'native' | 'none') {
  const listed: string[] = []
  let notify: ((dir: string) => void) | null = null
  const unused = (): never => {
    throw new Error('not used by the directory service')
  }
  const fs: MachineFileSystem = {
    machineId: MACHINE,
    homeDir: unused,
    stat: unused,
    readFile: unused,
    writeFile: unused,
    createDir: unused,
    rename: unused,
    remove: unused,
    openTransferSession: unused,
    downloadUrl: unused,
    listDir: async (dir) => {
      listed.push(dir)
      const entries = tree[dir]
      if (!entries) {
        throw new Error(`ENOENT ${dir}`)
      }
      return entries
    },
    watch: async (_dirs, onChange) => {
      if (watch === 'none') {
        return null
      }
      notify = onChange
      return () => {
        notify = null
      }
    }
  }
  return { fs, listed, emit: (dir: string) => notify?.(dir) }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MachineDirectoryService', () => {
  it('answers repeat reads from cache and revalidates stale ones in the background', async () => {
    const tree = { '/home': [file('a.txt')] }
    const { fs, listed } = fakeFileSystem(tree, 'none')
    let now = 1_000
    const changed: string[] = []
    const service = new MachineDirectoryService({
      resolveFileSystem: () => fs,
      onDirChanged: (_machine, path) => changed.push(path),
      now: () => now,
      staleAfterMs: 100
    })

    const first = await service.listDir(MACHINE, '/home')
    expect(first.fromCache).toBe(false)
    const second = await service.listDir(MACHINE, '/home')
    expect(second.fromCache).toBe(true)
    expect(listed).toEqual(['/home'])

    tree['/home'] = [file('a.txt'), file('b.txt')]
    now += 500
    const stale = await service.listDir(MACHINE, '/home')
    expect(stale.entries.map((e) => e.name)).toEqual(['a.txt'])
    await settle()
    expect(changed).toEqual(['/home'])
    const fresh = await service.listDir(MACHINE, '/home')
    expect(fresh.entries.map((e) => e.name)).toEqual(['a.txt', 'b.txt'])
  })

  it('sorts folders first and prefetches visible child folders so expanding is instant', async () => {
    const tree = {
      '/r': [file('z.txt'), folder('src'), folder('.git'), folder('docs')],
      '/r/src': [file('index.ts')],
      '/r/docs': [file('readme.md')]
    }
    const { fs, listed } = fakeFileSystem(tree, 'none')
    const service = new MachineDirectoryService({
      resolveFileSystem: () => fs,
      onDirChanged: () => {}
    })

    const root = await service.listDir(MACHINE, '/r')
    expect(root.entries.map((e) => e.name)).toEqual(['.git', 'docs', 'src', 'z.txt'])
    await settle()
    expect(listed.sort()).toEqual(['/r', '/r/docs', '/r/src'])
    expect((await service.listDir(MACHINE, '/r/src')).fromCache).toBe(true)
  })

  it('pages large folders but reports the full count', async () => {
    const names = Array.from({ length: 2500 }, (_, i) => file(`f${String(i).padStart(4, '0')}`))
    const { fs } = fakeFileSystem({ '/big': names }, 'none')
    const service = new MachineDirectoryService({
      resolveFileSystem: () => fs,
      onDirChanged: () => {}
    })
    const page1 = await service.listDir(MACHINE, '/big')
    const page2 = await service.listDir(MACHINE, '/big', { offset: page1.entries.length })
    expect(page1.totalEntries).toBe(2500)
    expect(page1.entries).toHaveLength(2000)
    expect(page2.entries).toHaveLength(500)
    expect(page2.entries[0]?.name).toBe('f2000')
  })

  it('re-lists a watched folder once per burst of native change events', async () => {
    vi.useFakeTimers()
    const tree = { '/w': [file('a')] }
    const { fs, listed, emit } = fakeFileSystem(tree, 'native')
    const changed: string[] = []
    const service = new MachineDirectoryService({
      resolveFileSystem: () => fs,
      onDirChanged: (_machine, path) => changed.push(path)
    })
    await service.listDir(MACHINE, '/w')
    await service.watchDirs(MACHINE, ['/w'])

    tree['/w'] = [file('a'), file('b')]
    emit('/w')
    emit('/w')
    emit('/w')
    await vi.advanceTimersByTimeAsync(300)
    expect(listed).toEqual(['/w', '/w'])
    expect(changed).toEqual(['/w'])
    service.dispose()
  })

  it('falls back to polling when the host has no change feed', async () => {
    vi.useFakeTimers()
    const tree = { '/p': [file('a')] }
    const { fs } = fakeFileSystem(tree, 'none')
    const changed: string[] = []
    const service = new MachineDirectoryService({
      resolveFileSystem: () => fs,
      onDirChanged: (_machine, path) => changed.push(path),
      pollIntervalMs: 1_000
    })
    await service.listDir(MACHINE, '/p')
    await service.watchDirs(MACHINE, ['/p'])
    tree['/p'] = [file('a', 99)]
    await vi.advanceTimersByTimeAsync(1_100)
    expect(changed).toEqual(['/p'])

    await service.watchDirs(MACHINE, [])
    tree['/p'] = [file('a', 100)]
    await vi.advanceTimersByTimeAsync(5_000)
    expect(changed).toEqual(['/p'])
  })
})
