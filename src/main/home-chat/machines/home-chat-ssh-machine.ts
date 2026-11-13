import { Readable } from 'node:stream'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import {
  execCommand,
  isSshCommandExitError,
  isSshExecTimeout
} from '../../ssh/remote-exec/remote-exec-command'
import { powerShellCommand } from '../../ssh/remote-exec/ssh-remote-powershell'
import type { RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { SshConnectionState, SshTarget } from '../../../shared/ssh-types'
import { sshMachineStatus } from '../../../shared/machines/machine-summaries'
import {
  decodeBase64File,
  posixLoadProbeScript,
  powerShellLoadProbeScript,
  parseLoadProbe,
  powerShellLiteral,
  readFileBase64Script,
  scriptWithCwd
} from './home-chat-machine-scripts'
import type {
  HomeChatExecOptions,
  HomeChatExecResult,
  HomeChatMachine,
  HomeChatMachineInfo,
  HomeChatShellDialect
} from './home-chat-machine-types'

export function sshMachineInfo(
  target: SshTarget,
  state: Pick<SshConnectionState, 'status' | 'error'> | undefined
): HomeChatMachineInfo {
  const { status, detail } = sshMachineStatus(state)
  const via = target.jumpHost
    ? `ProxyJump ${target.jumpHost}`
    : target.proxyCommand
      ? `ProxyCommand ${target.proxyCommand}`
      : undefined
  return {
    id: `ssh:${target.id}`,
    label: target.label,
    kind: 'ssh',
    address: `${target.username}@${target.host}:${target.port}`,
    ...(via ? { via } : {}),
    connected: status === 'online',
    status,
    ...(detail ? { statusDetail: detail } : {})
  }
}

async function execSsh(
  conn: SshConnection,
  dialect: HomeChatShellDialect,
  script: string,
  options: HomeChatExecOptions
): Promise<HomeChatExecResult> {
  const body = scriptWithCwd(dialect, script, options.cwd)
  // conn.exec encodes POSIX scripts itself; PowerShell needs -EncodedCommand to survive cmd.exe.
  const command = dialect === 'powershell' ? powerShellCommand(body) : body
  let stderr = ''
  try {
    const stdout = await execCommand(conn, command, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStderr: (chunk) => {
        stderr += chunk
      },
      ...(dialect === 'powershell' ? { wrapCommand: false } : { compressCommand: true }),
      ...(options.stdin !== undefined ? { stdin: Readable.from([Buffer.from(options.stdin)]) } : {})
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

export function createSshMachine(
  target: SshTarget,
  conn: SshConnection,
  host: RemoteHostPlatform | null
): HomeChatMachine {
  const dialect: HomeChatShellDialect =
    host?.commandDialect === 'powershell' ? 'powershell' : 'posix'
  const run = (script: string, options: HomeChatExecOptions): Promise<HomeChatExecResult> =>
    execSsh(conn, dialect, script, options)
  const quiet = (script: string): Promise<HomeChatExecResult> => run(script, { timeoutMs: 30_000 })
  const transferOptions = host ? { hostPlatform: host } : undefined
  return {
    info: {
      ...sshMachineInfo(target, { status: 'connected', error: null }),
      ...(host ? { platform: host.os } : {})
    },
    dialect,
    exec: run,
    readTextFile: async (path, maxBytes) => {
      const result = await quiet(readFileBase64Script(dialect, path, maxBytes))
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `could not read ${path}`)
      }
      return decodeBase64File(result.stdout, maxBytes)
    },
    writeTextFile: async (path, content, { append }) => {
      const dir = path.replaceAll('\\', '/').split('/').slice(0, -1).join('/')
      if (dir) {
        await quiet(
          dialect === 'powershell'
            ? `New-Item -ItemType Directory -Force -Path ${powerShellLiteral(dir)} | Out-Null`
            : `mkdir -p -- ${quotePosixShell(dir)}`
        )
      }
      await conn.writeBuffer(path, Buffer.from(content, 'utf8'), { append, ...transferOptions })
    },
    downloadTo: (remotePath, localPath) =>
      conn.downloadFile(remotePath, localPath, transferOptions),
    uploadFrom: async (localPath, remotePath) => {
      const session = await conn.openFileUploadSession(transferOptions)
      try {
        await session.uploadFile(localPath, remotePath)
      } finally {
        session.close()
      }
    },
    probeLoad: async () =>
      parseLoadProbe(
        (
          await quiet(
            dialect === 'powershell' ? powerShellLoadProbeScript() : posixLoadProbeScript()
          )
        ).stdout
      )
  }
}
