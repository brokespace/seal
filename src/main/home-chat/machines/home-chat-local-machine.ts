import { appendFile, copyFile, mkdir, open, writeFile } from 'node:fs/promises'
import { cpus, homedir, hostname, loadavg } from 'node:os'
import { dirname } from 'node:path'
import { runLocalShellScript } from '../../machines/exec/local-shell-exec'
import { LOCAL_MACHINE_ID, type HomeChatMachine } from './home-chat-machine-types'

async function readLocalText(
  path: string,
  maxBytes: number
): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, maxBytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    return { text: buffer.toString('utf8'), truncated: size > maxBytes }
  } finally {
    await handle.close()
  }
}

async function copyLocal(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true })
  await copyFile(from, to)
}

export function createLocalMachine(): HomeChatMachine {
  return {
    info: {
      id: LOCAL_MACHINE_ID,
      label: `${hostname()} (this computer)`,
      kind: 'local',
      connected: true,
      status: 'online',
      platform: process.platform
    },
    dialect: process.platform === 'win32' ? 'powershell' : 'posix',
    exec: runLocalShellScript,
    homeDir: () => Promise.resolve(homedir()),
    readTextFile: readLocalText,
    writeTextFile: async (path, content, { append }) => {
      await mkdir(dirname(path), { recursive: true })
      await (append ? appendFile(path, content, 'utf8') : writeFile(path, content, 'utf8'))
    },
    downloadTo: copyLocal,
    uploadFrom: copyLocal,
    probeLoad: () =>
      Promise.resolve({
        cpuCount: cpus().length,
        // Windows always reports zeros, which would make it look idle.
        loadAverage1m: process.platform === 'win32' ? null : loadavg()[0]
      })
  }
}
