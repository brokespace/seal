import { runProcess } from '@orca/process-host'
import { appendFile, copyFile, mkdir, open, writeFile } from 'node:fs/promises'
import { cpus, hostname, loadavg } from 'node:os'
import { dirname } from 'node:path'
import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'
import {
  LOCAL_MACHINE_ID,
  type HomeChatExecOptions,
  type HomeChatExecResult,
  type HomeChatMachine
} from './home-chat-machine-types'

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

function shellInvocation(command: string): { program: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      program: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        encodePowerShellCommand(command)
      ]
    }
  }
  return { program: process.env.SHELL || '/bin/sh', args: ['-lc', command] }
}

async function execLocal(
  command: string,
  options: HomeChatExecOptions
): Promise<HomeChatExecResult> {
  const { program, args } = shellInvocation(command)
  const result = await runProcess({
    program,
    args,
    cwd: options.cwd,
    ...(options.stdin !== undefined ? { input: options.stdin } : {}),
    env: process.env,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })
  return {
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}

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
      platform: process.platform
    },
    dialect: process.platform === 'win32' ? 'powershell' : 'posix',
    exec: execLocal,
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
