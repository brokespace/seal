import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MachineTransfer } from '../../../shared/machines/machine-types'
import { createLocalMachineFileSystem } from '../filesystem/local-machine-filesystem'
import { MachineTransferManager } from './machine-transfer-manager'

function managerWithUpdates() {
  const finished = new Map<string, (transfer: MachineTransfer) => void>()
  const changedDirs: string[] = []
  const fs = createLocalMachineFileSystem()
  const manager = new MachineTransferManager({
    resolveFileSystem: () => fs,
    onUpdate: (transfer) => {
      if (transfer.status !== 'running') {
        finished.get(transfer.id)?.(transfer)
      }
    },
    onRemoteDirChanged: (_machine, dir) => changedDirs.push(dir)
  })
  const settled = (transfer: MachineTransfer): Promise<MachineTransfer> =>
    new Promise((resolve) => finished.set(transfer.id, resolve))
  return { manager, settled, changedDirs }
}

describe('MachineTransferManager (local machine)', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'machine-transfer-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('uploads files and nested folders, renaming instead of overwriting', async () => {
    const source = path.join(root, 'source')
    mkdirSync(path.join(source, 'project', 'src', 'empty'), { recursive: true })
    writeFileSync(path.join(source, 'project', 'README.md'), 'readme')
    writeFileSync(path.join(source, 'project', 'src', 'main.ts'), 'x'.repeat(100_000))
    writeFileSync(path.join(source, 'notes.txt'), 'new notes')
    const dest = path.join(root, 'dest')
    mkdirSync(dest)
    writeFileSync(path.join(dest, 'notes.txt'), 'keep me')

    const { manager, settled, changedDirs } = managerWithUpdates()
    const started = manager.upload(
      'local',
      [path.join(source, 'project'), path.join(source, 'notes.txt')],
      dest
    )
    const result = await settled(started)

    expect(result).toMatchObject({
      status: 'done',
      error: null,
      filesTotal: 3,
      filesDone: 3,
      totalBytes: 100_015,
      transferredBytes: 100_015
    })
    expect(readdirSync(dest).sort()).toEqual(['notes (1).txt', 'notes.txt', 'project'])
    expect(readFileSync(path.join(dest, 'notes.txt'), 'utf8')).toBe('keep me')
    expect(readFileSync(path.join(dest, 'notes (1).txt'), 'utf8')).toBe('new notes')
    expect(readFileSync(path.join(dest, 'project', 'src', 'main.ts'), 'utf8')).toHaveLength(100_000)
    expect(readdirSync(path.join(dest, 'project', 'src', 'empty'))).toEqual([])
    expect(changedDirs).toEqual([dest])
  })

  it('downloads a machine folder into a local folder', async () => {
    const remote = path.join(root, 'remote', 'logs')
    mkdirSync(path.join(remote, 'old'), { recursive: true })
    writeFileSync(path.join(remote, 'old', 'a.log'), 'aaa')
    const local = path.join(root, 'local')
    mkdirSync(local)

    const { manager, settled } = managerWithUpdates()
    const result = await settled(manager.download('local', [remote], local))

    expect(result.status).toBe('done')
    expect(readFileSync(path.join(local, 'logs', 'old', 'a.log'), 'utf8')).toBe('aaa')
  })

  it('reports a missing source as a failed transfer', async () => {
    const { manager, settled } = managerWithUpdates()
    const result = await settled(manager.upload('local', [path.join(root, 'does-not-exist')], root))
    expect(result.status).toBe('failed')
    expect(result.error).toBeTruthy()
  })
})
