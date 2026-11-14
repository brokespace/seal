import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeSubscriptionRegistry } from '../../runtime/client/runtime-subscription-registry'
import { machineHostFileSystem } from '../../runtime/rpc/methods/machines/machine-host-file-io'
import type { MachineHostStreamEvent } from '../../../shared/machines/machine-host-wire'
import { createInProcessRuntimeChannel } from '../testing/machine-transport-test-doubles'
import { RuntimeMachineFileSystem } from './runtime-machine-filesystem'
import { runtimeMachineError } from './runtime-machine-channel'

describe('RuntimeMachineFileSystem over the machineHost runtime surface', () => {
  let root: string
  let registry: RuntimeSubscriptionRegistry
  let emitted: MachineHostStreamEvent[]
  let fs: RuntimeMachineFileSystem
  let server: Server | null = null

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'seal-runtime-machine-'))
    registry = new RuntimeSubscriptionRegistry()
    const inProcess = createInProcessRuntimeChannel(registry)
    emitted = inProcess.emitted
    fs = new RuntimeMachineFileSystem('machine:kessel-ml', inProcess.channel)
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()))
    server = null
    await rm(root, { recursive: true, force: true })
  })

  it('uploads and downloads multi-slice files byte-for-byte, reporting every byte', async () => {
    const payload = randomBytes(2 * 1024 * 1024 + 4321)
    const local = path.join(root, 'local.bin')
    const remote = path.join(root, 'remote', 'model.bin')
    const back = path.join(root, 'back', 'model.bin')
    await writeFile(local, payload)
    const session = await fs.openTransferSession(new AbortController().signal)

    let uploaded = 0
    await session.uploadFile(local, remote, payload.length, (delta) => {
      uploaded += delta
    })
    let downloaded = 0
    await session.downloadFile(remote, back, payload.length, (delta) => {
      downloaded += delta
    })

    expect(uploaded).toBe(2 * 1024 * 1024 + 4321)
    expect(downloaded).toBe(2 * 1024 * 1024 + 4321)
    expect((await readFile(remote)).equals(payload)).toBe(true)
    expect((await readFile(back)).equals(payload)).toBe(true)
  })

  it('stops an upload when the transfer is cancelled', async () => {
    const local = path.join(root, 'big.bin')
    await writeFile(local, randomBytes(4 * 1024 * 1024))
    const controller = new AbortController()
    const session = await fs.openTransferSession(controller.signal)
    controller.abort()
    await expect(
      session.uploadFile(local, path.join(root, 'partial.bin'), 4 * 1024 * 1024, () => {})
    ).rejects.toThrow()
  })

  it('lists folders larger than one reply without losing or repeating entries', async () => {
    const dir = path.join(root, 'many')
    await machineHostFileSystem.createDir(dir)
    await Promise.all(
      Array.from({ length: 5_003 }, (_, i) => writeFile(path.join(dir, `f${i}`), ''))
    )

    const names = (await fs.listDir(dir)).map((entry) => entry.name)

    expect(names).toHaveLength(5_003)
    expect(new Set(names).size).toBe(5_003)
  })

  it('previews only the requested head of a file while reporting its full size', async () => {
    const payload = randomBytes(3 * 1024 * 1024)
    const remote = path.join(root, 'video.bin')
    await writeFile(remote, payload)

    const preview = await fs.readFile(remote, 1_500_000)

    expect(preview.size).toBe(3 * 1024 * 1024)
    expect(preview.data.equals(payload.subarray(0, 1_500_000))).toBe(true)
  })

  it('renames, refuses to clobber, and deletes folders recursively', async () => {
    await writeFile(path.join(root, 'a.txt'), 'a')
    await writeFile(path.join(root, 'b.txt'), 'b')
    await expect(fs.rename(path.join(root, 'a.txt'), path.join(root, 'b.txt'))).rejects.toThrow(
      'Destination already exists'
    )
    await fs.createDir(path.join(root, 'nested', 'deep'))
    await fs.remove(path.join(root, 'nested'))

    expect((await readdir(root)).sort()).toEqual(['a.txt', 'b.txt'])
    await expect(fs.remove(path.parse(root).root)).rejects.toThrow('filesystem root')
  })

  it('streams folder changes from the runtime, and stopping retires the runtime watcher', async () => {
    const changes: string[] = []
    const stop = await fs.watch([root], (dir) => changes.push(dir))
    expect(stop).not.toBeNull()

    await writeFile(path.join(root, 'new.txt'), 'x')
    await vi.waitFor(() => expect(changes).toContain(root), { timeout: 5_000 })
    stop?.()

    await vi.waitFor(() => expect(emitted.at(-1)).toEqual({ type: 'end' }))
  })

  it('downloads a URL on the runtime host with progress and removes a failed partial file', async () => {
    const body = randomBytes(300_000)
    server = createServer((request, response) => {
      if (request.url === '/missing') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': String(body.length) }).end(body)
    })
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('test server has no port')
    }
    const { port } = address
    const destination = path.join(root, 'downloads', 'weights.bin')
    const progress: [number, number | null][] = []

    await fs.downloadUrl(
      `http://127.0.0.1:${port}/weights.bin`,
      destination,
      (transferred, total) => progress.push([transferred, total]),
      new AbortController().signal
    )
    await expect(
      fs.downloadUrl(
        `http://127.0.0.1:${port}/missing`,
        path.join(root, 'missing.bin'),
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow('HTTP 404')

    expect((await readFile(destination)).equals(body)).toBe(true)
    expect(progress.at(-1)).toEqual([300_000, 300_000])
    expect(await readdir(root)).not.toContain('missing.bin')
  })

  it('asks for a runtime update instead of failing opaquely on an older Seal runtime', async () => {
    const outdated = runtimeMachineError({ code: 'method_not_found', message: 'Unknown method' })
    const old = new RuntimeMachineFileSystem('machine:old-box', {
      call: async () => {
        throw outdated
      },
      stream: async (_method, _params, handlers) => {
        queueMicrotask(() => handlers.onError(outdated.message))
        return { close: () => {} }
      }
    })

    await expect(old.listDir('/home/brian')).rejects.toThrow(
      'Update Seal on this runtime to manage its files and stats from Machines'
    )
    expect(await old.watch(['/home/brian'], () => {})).toBeNull()
  })
})
