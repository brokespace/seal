import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { MachineConnection } from '../../machines/connection/machine-connection'
import type { MachineView } from '../../../shared/machines/machine-view'
import type { MachineSummary } from '../../../shared/machines/machine-summaries'
import type { HomeChatMachine, HomeChatMachineInfo } from './home-chat-machine-types'

// Appends re-send the whole file; past this, the chat should write a new file instead.
const MAX_APPEND_BASE_BYTES = 8 * 1024 * 1024

/** Info for a machine, whichever transport it uses; the old `ssh:` spelling stays an alias. */
export function unifiedMachineInfo(
  view: MachineView,
  summary: MachineSummary
): HomeChatMachineInfo {
  const overSsh = summary.connection === 'ssh'
  return {
    id: view.id,
    label: view.name,
    kind: 'remote',
    ...(summary.address ? { address: summary.address } : {}),
    ...(overSsh && view.ssh?.jumpHost
      ? { via: `ProxyJump ${view.ssh.jumpHost}` }
      : overSsh
        ? {}
        : { via: 'Seal server' }),
    aliases: [
      ...(view.ssh ? [`ssh:${view.ssh.targetId}`] : []),
      ...(view.server ? [`runtime:${view.server.environmentId}`] : [])
    ],
    executionHostId: summary.executionHostId,
    // An offline SSH machine still connects on demand; a server must already answer.
    connected: summary.status === 'online',
    status: summary.status,
    ...(summary.statusDetail ? { statusDetail: summary.statusDetail } : {}),
    ...(view.server ? { sealServer: true } : {}),
    ...(summary.os ? { platform: summary.os } : {})
  }
}

function parentDir(path: string): string | null {
  const parts = path.replaceAll('\\', '/').split('/').slice(0, -1)
  const dir = parts.join('/')
  return dir || null
}

/** Every home-chat tool runs through the machine's own connection, so SSH and server match. */
export async function createUnifiedMachine(
  view: MachineView,
  summary: MachineSummary,
  connection: MachineConnection
): Promise<HomeChatMachine> {
  await connection.connect()
  const dialect = await connection.dialect()
  const files = connection.files
  return {
    info: unifiedMachineInfo(view, { ...summary, status: 'online', statusDetail: null }),
    dialect,
    exec: (script, options) =>
      connection.exec(script, {
        timeoutMs: options.timeoutMs,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.stdin !== undefined ? { stdin: options.stdin } : {})
      }),
    homeDir: () => files.homeDir(),
    readTextFile: async (path, maxBytes) => {
      const { size, data } = await files.readFile(path, maxBytes)
      return { text: data.toString('utf8'), truncated: size > data.length }
    },
    writeTextFile: async (path, content, { append }) => {
      const dir = parentDir(path)
      if (dir) {
        await files.createDir(dir).catch(() => {})
      }
      let base: Buffer = Buffer.alloc(0)
      if (append) {
        const existing = await files.readFile(path, MAX_APPEND_BASE_BYTES).catch(() => null)
        if (existing && existing.size > existing.data.length) {
          throw new Error(`${path} is too large to append to; write a new file instead`)
        }
        base = existing?.data ?? base
      }
      await files.writeFile(path, Buffer.concat([base, Buffer.from(content, 'utf8')]))
    },
    downloadTo: async (remotePath, localPath) => {
      const { size } = await files.stat(remotePath)
      await mkdir(dirname(localPath), { recursive: true })
      const session = await files.openTransferSession(new AbortController().signal)
      try {
        await session.downloadFile(remotePath, localPath, size, () => {})
      } finally {
        session.close()
      }
    },
    uploadFrom: async (localPath, remotePath) => {
      const size = (await stat(localPath)).size
      const dir = parentDir(remotePath)
      if (dir) {
        await files.createDir(dir).catch(() => {})
      }
      const session = await files.openTransferSession(new AbortController().signal)
      try {
        await session.uploadFile(localPath, remotePath, size, () => {})
      } finally {
        session.close()
      }
    },
    probeLoad: async () => {
      const metrics = await connection.metrics()
      return { cpuCount: metrics.cpuCount, loadAverage1m: metrics.loadAverage?.[0] ?? null }
    }
  }
}
