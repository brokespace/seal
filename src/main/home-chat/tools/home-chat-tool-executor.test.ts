import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { HomeChatMachine, HomeChatMachineInfo } from '../machines/home-chat-machine-types'
import {
  createTestHomeChatRuntime,
  testToolContext
} from '../testing/home-chat-runtime.test-support'
import { executeHomeChatTool } from './home-chat-tool-executor'

let root: string

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** A "remote" machine whose filesystem is a folder; only the transfer surface is real. */
function folderMachine(id: string, fsRoot: string): HomeChatMachine {
  const info: HomeChatMachineInfo = {
    id,
    label: id,
    kind: 'remote',
    connected: true,
    status: 'online'
  }
  const unsupported = (): Promise<never> => Promise.reject(new Error('unsupported'))
  return {
    info,
    dialect: 'posix',
    exec: unsupported,
    homeDir: unsupported,
    readTextFile: unsupported,
    writeTextFile: unsupported,
    probeLoad: unsupported,
    downloadTo: (remotePath, localPath) => copyFile(join(fsRoot, remotePath), localPath),
    uploadFrom: async (localPath, remotePath) => {
      await mkdir(dirname(join(fsRoot, remotePath)), { recursive: true })
      await copyFile(localPath, join(fsRoot, remotePath))
    }
  }
}

describe('executeHomeChatTool transfer_file', () => {
  it('copies between two remote machines by staging through this computer', async () => {
    root = await mkdtemp(join(tmpdir(), 'home-chat-transfer-'))
    const a = folderMachine('ssh:a', join(root, 'a'))
    const b = folderMachine('ssh:b', join(root, 'b'))
    await mkdir(join(root, 'a', 'data'), { recursive: true })
    await writeFile(join(root, 'a', 'data', 'model.bin'), 'weights')
    const { runtime } = createTestHomeChatRuntime(root, {
      list: () => Promise.resolve([a.info, b.info]),
      open: (id) => Promise.resolve(id === 'ssh:a' ? a : b)
    })
    await runtime.load()
    const ctx = testToolContext(runtime)

    const result = await executeHomeChatTool(
      'transfer_file',
      {
        from_machine: 'ssh:a',
        from_path: '/data/model.bin',
        to_machine: 'ssh:b',
        to_path: '/in/model.bin'
      },
      ctx
    )

    expect(result).toEqual({
      text: 'Copied /data/model.bin to /in/model.bin (ssh:a → ssh:b).',
      isError: false,
      machine: 'ssh:a → ssh:b'
    })
    expect(await readFile(join(root, 'b', 'in', 'model.bin'), 'utf8')).toBe('weights')
  })
})
