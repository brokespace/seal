import { randomUUID } from 'node:crypto'
import { wrapRemoteCommandForPosixShell } from '../../ssh/remote-exec/ssh-posix-command-wrapper'
import { powerShellCommand } from '../../ssh/remote-exec/ssh-remote-powershell'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import type { HomeChatMachineNote } from '../../../shared/home-chat/home-chat-memory-types'
import {
  decodeBase64File,
  parseLoadProbe,
  posixLoadProbeScript,
  powerShellLoadProbeScript,
  readFileBase64Script,
  scriptWithCwd,
  writeFromStdinScript
} from './home-chat-machine-scripts'
import type {
  HomeChatExecOptions,
  HomeChatMachine,
  HomeChatMachineInfo,
  HomeChatShellDialect
} from './home-chat-machine-types'

export const HOP_MACHINE_PREFIX = 'hop:'

// BatchMode fails fast instead of hanging on a password prompt nobody can answer.
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20']

function destination(note: HomeChatMachineNote): string {
  return note.user ? `${note.user}@${note.host}` : String(note.host)
}

export function isHopNote(note: HomeChatMachineNote): boolean {
  return note.machine.startsWith(HOP_MACHINE_PREFIX) && Boolean(note.via && note.host)
}

export function hopMachineInfo(
  note: HomeChatMachineNote,
  viaConnected: boolean
): HomeChatMachineInfo {
  return {
    id: note.machine,
    label: note.machine.slice(HOP_MACHINE_PREFIX.length),
    kind: 'hop',
    address: `${destination(note)}:${note.port ?? 22}`,
    via: note.via,
    connected: viaConnected,
    status: viaConnected ? 'online' : 'offline',
    ...(note.os ? { platform: note.os } : {}),
    ...(note.notes ? { notes: note.notes } : {})
  }
}

/** The ssh invocation to run on the parent machine; the remote script is encoded so no quoting can break it. */
export function hopSshCommand(note: HomeChatMachineNote, remoteScript: string): string {
  const remote =
    note.os === 'windows'
      ? powerShellCommand(remoteScript)
      : wrapRemoteCommandForPosixShell(remoteScript, { compress: true })
  const port = note.port ? ['-p', String(note.port)] : []
  return ['ssh', ...SSH_OPTIONS, ...port, destination(note), '--', remote]
    .map(quotePosixShell)
    .join(' ')
}

function scpCommand(note: HomeChatMachineNote, from: string, to: string): string {
  const port = note.port ? ['-P', String(note.port)] : []
  return ['scp', '-q', ...SSH_OPTIONS, ...port, from, to].map(quotePosixShell).join(' ')
}

/** A machine Seal reaches by running ssh on another machine ("reach X through Y"). */
export function createHopMachine(
  note: HomeChatMachineNote,
  parent: HomeChatMachine
): HomeChatMachine {
  if (parent.dialect !== 'posix') {
    throw new Error(
      `${note.machine} is reached through ${parent.info.label}, which needs a POSIX shell with ssh.`
    )
  }
  const dialect: HomeChatShellDialect = note.os === 'windows' ? 'powershell' : 'posix'
  const exec = (script: string, options: HomeChatExecOptions) =>
    parent.exec(hopSshCommand(note, scriptWithCwd(dialect, script, options.cwd)), {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      stdin: options.stdin
    })
  const quiet = (script: string, stdin?: string | Buffer) =>
    exec(script, { timeoutMs: 60_000, ...(stdin !== undefined ? { stdin } : {}) })
  const failIfNonZero = (result: { exitCode: number | null; stderr: string }, what: string) => {
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `${what} failed on ${note.machine}`)
    }
  }
  // Stage through the parent's temp dir: files stream over disk, never through memory.
  const stage = async (copy: (staged: string) => Promise<void>) => {
    const staged = `/tmp/seal-hop-${randomUUID()}`
    try {
      await copy(staged)
    } finally {
      await parent.exec(`rm -f -- ${quotePosixShell(staged)}`, { timeoutMs: 30_000 })
    }
  }
  const remote = (path: string) => `${destination(note)}:${path}`
  return {
    info: hopMachineInfo(note, true),
    dialect,
    exec,
    readTextFile: async (path, maxBytes) => {
      const result = await quiet(readFileBase64Script(dialect, path, maxBytes))
      failIfNonZero(result, `reading ${path}`)
      return decodeBase64File(result.stdout, maxBytes)
    },
    writeTextFile: async (path, content, { append }) => {
      failIfNonZero(
        await quiet(writeFromStdinScript(dialect, path, append), content),
        `writing ${path}`
      )
    },
    downloadTo: (remotePath, localPath) =>
      stage(async (staged) => {
        const result = await parent.exec(scpCommand(note, remote(remotePath), staged), {
          timeoutMs: 6 * 60 * 60_000
        })
        failIfNonZero(result, `copying ${remotePath}`)
        await parent.downloadTo(staged, localPath)
      }),
    uploadFrom: (localPath, remotePath) =>
      stage(async (staged) => {
        await parent.uploadFrom(localPath, staged)
        const result = await parent.exec(scpCommand(note, staged, remote(remotePath)), {
          timeoutMs: 6 * 60 * 60_000
        })
        failIfNonZero(result, `copying to ${remotePath}`)
      }),
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
