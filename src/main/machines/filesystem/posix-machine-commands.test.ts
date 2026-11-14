import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  parsePosixListDirOutput,
  posixListDirCommand,
  posixRenameCommand
} from './posix-machine-commands'

function runSh(script: string): string {
  return execFileSync('sh', ['-c', script], { encoding: 'utf8', stdio: 'pipe' })
}

// These scripts run on remote hosts; the local sh stands in for one.
describe.skipIf(process.platform === 'win32')('posix machine commands', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'machine-cmd-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists odd names, hidden files and symlinked folders in one pass', () => {
    writeFileSync(path.join(dir, 'with space.txt'), 'hello')
    writeFileSync(path.join(dir, '.hidden'), '')
    writeFileSync(path.join(dir, '..dots'), 'x')
    mkdirSync(path.join(dir, 'sub'))
    symlinkSync(path.join(dir, 'sub'), path.join(dir, 'link-to-sub'))
    symlinkSync(path.join(dir, 'missing'), path.join(dir, 'broken'))

    const entries = parsePosixListDirOutput(runSh(posixListDirCommand(dir)))
    const byName = new Map(entries.map((entry) => [entry.name, entry]))

    expect([...byName.keys()].sort()).toEqual(
      ['..dots', '.hidden', 'broken', 'link-to-sub', 'sub', 'with space.txt'].sort()
    )
    expect(byName.get('with space.txt')).toMatchObject({ kind: 'file', size: 5 })
    expect(byName.get('sub')).toMatchObject({ kind: 'directory', isDirectoryLike: true })
    expect(byName.get('link-to-sub')).toMatchObject({ kind: 'symlink', isDirectoryLike: true })
    expect(byName.get('broken')).toMatchObject({ kind: 'symlink', isDirectoryLike: false })
  })

  it('lists an empty folder as empty', () => {
    expect(parsePosixListDirOutput(runSh(posixListDirCommand(dir)))).toEqual([])
  })

  it('refuses to rename over an existing name', () => {
    writeFileSync(path.join(dir, 'a'), 'a')
    writeFileSync(path.join(dir, 'b'), 'b')
    expect(() => runSh(posixRenameCommand(path.join(dir, 'a'), path.join(dir, 'b')))).toThrow()
    expect(runSh(`cat ${JSON.stringify(path.join(dir, 'b'))}`)).toBe('b')
  })
})
