import { readFile } from 'node:fs/promises'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  execCommand,
  isSshCommandExitError,
  isSshExecTimeout
} from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { SshTarget } from '../../../shared/ssh-types'
import type {
  HomeChatExecOptions,
  HomeChatExecResult,
  HomeChatMachine,
  HomeChatMachineInfo
} from './home-chat-machine-types'

export function sshMachineInfo(target: SshTarget, connected: boolean): HomeChatMachineInfo {
  return {
    id: `ssh:${target.id}`,
    label: target.label,
    kind: 'ssh',
    address: `${target.username}@${target.host}:${target.port}`,
    connected
  }
}

async function execSsh(
  conn: SshConnection,
  command: string,
  options: HomeChatExecOptions
): Promise<HomeChatExecResult> {
  const script = options.cwd ? `cd ${quotePosixShell(options.cwd)} && ${command}` : command
  let stderr = ''
  const onStderr = (chunk: string): void => {
    stderr += chunk
  }
  try {
    const stdout = await execCommand(conn, script, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStderr
    })
    return { exitCode: 0, stdout, stderr, timedOut: false }
  } catch (error) {
    if (isSshCommandExitError(error)) {
      return { exitCode: error.exitCode, stdout: error.stdout, stderr, timedOut: false }
    }
    if (isSshExecTimeout(error)) {
      return { exitCode: null, stdout: '', stderr, timedOut: true }
    }
    throw error
  }
}

export function createSshMachine(target: SshTarget, conn: SshConnection): HomeChatMachine {
  const quietExec = (command: string): Promise<HomeChatExecResult> =>
    execSsh(conn, command, { timeoutMs: 20_000 })
  return {
    info: sshMachineInfo(target, true),
    exec: (command, options) => execSsh(conn, command, options),
    readTextFile: async (path, maxBytes) => {
      const quoted = quotePosixShell(path)
      // One extra byte tells a file of exactly maxBytes apart from a longer one.
      const result = await quietExec(`head -c ${maxBytes + 1} -- ${quoted}`)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `could not read ${path}`)
      }
      const truncated = Buffer.byteLength(result.stdout, 'utf8') > maxBytes
      return { text: truncated ? result.stdout.slice(0, maxBytes) : result.stdout, truncated }
    },
    writeTextFile: async (path, content, { append }) => {
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (dir) {
        await quietExec(`mkdir -p -- ${quotePosixShell(dir)}`)
      }
      await conn.writeBuffer(path, Buffer.from(content, 'utf8'), { append })
    },
    downloadTo: (remotePath, localPath) => conn.downloadFile(remotePath, localPath),
    uploadFrom: async (localPath, remotePath) => {
      await conn.writeBuffer(remotePath, await readFile(localPath))
    },
    probeLoad: async () => {
      const result = await quietExec(
        'getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null; cut -d" " -f1 /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null | tr -d "{}" | cut -d" " -f2'
      )
      const [cpu, load] = result.stdout.trim().split(/\s+/)
      const cpuCount = Number.parseInt(cpu ?? '', 10)
      const loadAverage = Number.parseFloat(load ?? '')
      return {
        cpuCount: Number.isFinite(cpuCount) ? cpuCount : null,
        loadAverage1m: Number.isFinite(loadAverage) ? loadAverage : null
      }
    }
  }
}
