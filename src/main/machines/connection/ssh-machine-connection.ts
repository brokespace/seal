import { Readable } from 'node:stream'
import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import type { MachineIdentity } from '../../../shared/machines/machine-record'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import {
  execCommand,
  isSshCommandExitError,
  isSshExecTimeout
} from '../../ssh/remote-exec/remote-exec-command'
import { powerShellCommand } from '../../ssh/remote-exec/ssh-remote-powershell'
import { scriptWithCwd } from '../../home-chat/machines/home-chat-machine-scripts'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'
import { SshMachineFileSystem } from '../filesystem/ssh-machine-filesystem'
import { collectSshMachineMetrics } from '../metrics/machine-metrics'
import type {
  MachineConnection,
  MachineExecOptions,
  MachineShell,
  MachineShellDialect,
  MachineShellHandlers,
  MachineShellOptions
} from './machine-connection'
import { machineIdentityScript, parseMachineIdentity } from './machine-identity-probe'
import { withPollingWatch } from './machine-polling-watch'
import type { SshMachineLink } from './ssh-machine-link'

const IDENTITY_TIMEOUT_MS = 15_000

export async function execOverSsh(
  conn: SshMachineLink,
  dialect: MachineShellDialect,
  script: string,
  options: MachineExecOptions
): Promise<MachineExecResult> {
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

/** What the shell runs first: change folder, then the command (or stay at a prompt). */
export function sshShellPrelude(
  dialect: MachineShellDialect,
  options: Pick<MachineShellOptions, 'cwd' | 'command'>
): string | null {
  if (!options.cwd && !options.command) {
    return null
  }
  if (dialect === 'powershell') {
    const cd = options.cwd ? `Set-Location -LiteralPath '${options.cwd.replaceAll("'", "''")}'` : ''
    return [cd, options.command ? `${options.command}; exit` : ''].filter(Boolean).join('; ')
  }
  const cd = options.cwd ? `cd -- ${quotePosixShell(options.cwd)}` : ''
  return [cd, options.command ? `${options.command}; exit` : ''].filter(Boolean).join(' && ')
}

export type SshMachineConnectionDeps = {
  link: () => SshMachineLink | null
  connect: () => Promise<void>
  /** System-ssh hosts have no ssh2 shell channel; their shells run the ssh binary in a local PTY. */
  openSystemShell: (
    prelude: string | null,
    options: MachineShellOptions,
    handlers: MachineShellHandlers
  ) => Promise<MachineShell>
}

export class SshMachineConnection implements MachineConnection {
  readonly transport = 'ssh'
  readonly files: MachineFileSystem

  constructor(
    readonly machineId: MachineId,
    private readonly deps: SshMachineConnectionDeps
  ) {
    this.files = withPollingWatch(new SshMachineFileSystem(machineId, deps.link))
  }

  private requireLink(): SshMachineLink {
    const link = this.deps.link()
    if (!link || link.getState().status !== 'connected') {
      throw new Error('Machine is not connected')
    }
    return link
  }

  isConnected(): boolean {
    return this.deps.link()?.getState().status === 'connected'
  }

  async connect(): Promise<void> {
    if (!this.isConnected()) {
      await this.deps.connect()
    }
  }

  async dialect(): Promise<MachineShellDialect> {
    return this.requireLink().getState().remotePlatform === 'win32' ? 'powershell' : 'posix'
  }

  async exec(script: string, options: MachineExecOptions): Promise<MachineExecResult> {
    const link = this.requireLink()
    return execOverSsh(link, await this.dialect(), script, options)
  }

  metrics(): Promise<MachineMetrics> {
    return collectSshMachineMetrics(this.requireLink())
  }

  async identity(): Promise<MachineIdentity> {
    const dialect = await this.dialect()
    const result = await this.exec(machineIdentityScript(dialect), {
      timeoutMs: IDENTITY_TIMEOUT_MS
    })
    return parseMachineIdentity(result.stdout)
  }

  async openShell(
    options: MachineShellOptions,
    handlers: MachineShellHandlers
  ): Promise<MachineShell> {
    const link = this.requireLink()
    const prelude = sshShellPrelude(await this.dialect(), options)
    if (link.usesSystemSshTransport()) {
      return this.deps.openSystemShell(prelude, options, handlers)
    }
    const channel = await link.shell({
      cols: options.cols,
      rows: options.rows,
      term: 'xterm-256color'
    })
    let closed = false
    channel.on('data', (chunk: Buffer) => handlers.onData(chunk.toString('utf8')))
    channel.stderr.on('data', (chunk: Buffer) => handlers.onData(chunk.toString('utf8')))
    channel.once('close', (code: unknown) => {
      closed = true
      handlers.onExit(typeof code === 'number' ? code : null)
    })
    if (prelude) {
      channel.write(`${prelude}\n`)
    }
    return {
      write: (data) => {
        if (!closed) {
          channel.write(data)
        }
      },
      resize: (cols, rows) => {
        if (!closed) {
          channel.setWindow(rows, cols, 0, 0)
        }
      },
      close: () => {
        if (!closed) {
          channel.close()
        }
      }
    }
  }
}
