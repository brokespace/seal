import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  scanMachineFiles,
  scanMachineFilesInFull,
  type MachineFileScanRunner
} from './machine-file-scan'

describe.skipIf(process.platform === 'win32')('file scan in a POSIX shell', () => {
  let home: string

  beforeEach(async () => {
    home = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seal-scan-sh-')))
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  /** `keepBytes` cuts the answer the way an SSH or server exec does past its limit. */
  const runner = (keepBytes = Number.POSITIVE_INFINITY): MachineFileScanRunner => ({
    dialect: 'posix',
    exec: async (script) => {
      const { stdout, stderr } = await promisify(execFile)('sh', ['-c', script], {
        env: { ...process.env, HOME: home },
        maxBuffer: 16 * 1024 * 1024
      })
      return { exitCode: 0, stdout: stdout.slice(0, keepBytes), stderr }
    }
  })
  const skill = async (name: string, content: string): Promise<void> => {
    await mkdir(path.join(home, 'skills', name), { recursive: true })
    await writeFile(path.join(home, 'skills', name, 'SKILL.md'), content)
  }
  const request = { skillRoots: [{ tag: 'skill', dir: '~/skills' }], headBytes: 4096 }

  it('reads a file that holds the separator bytes as one record', async () => {
    await skill('evil', 'before\u001eghost\u001f/evil/home\u001f0\u001fafter')

    const scan = await scanMachineFiles(runner(), request)

    expect(scan.home).toBe(home)
    expect(scan.records.map((record) => [record.tag, record.head])).toEqual([
      ['skill', 'beforeghost/evil/home0after']
    ])
  })

  it('asks again with shorter file starts when the answer was cut', async () => {
    for (const name of ['a', 'b', 'c']) {
      await skill(name, `${name}:${'x'.repeat(3000)}`)
    }

    const cut = await scanMachineFiles(runner(7000), request)
    expect(cut.complete).toBe(false)
    expect(cut.records.map((record) => record.head.slice(0, 2))).toEqual(['a:', 'b:'])

    const full = await scanMachineFilesInFull(runner(7000), request)
    expect(full.complete).toBe(true)
    expect(full.headBytes).toBe(1024)
    expect(full.records.map((record) => [record.head.slice(0, 2), record.bytes])).toEqual([
      ['a:', 3002],
      ['b:', 3002],
      ['c:', 3002]
    ])
  })

  it('says which folder holds more than it lists', async () => {
    for (let index = 0; index < 401; index += 1) {
      await skill(`s${String(index).padStart(3, '0')}`, 'x')
    }

    const scan = await scanMachineFiles(runner(), request)

    expect(scan.records).toHaveLength(400)
    expect(scan.capped).toEqual(['skill'])
    expect(scan.complete).toBe(true)
  })
})
