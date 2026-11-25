import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { appendFile, copyFile, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Duplex, type Readable, type Writable } from 'node:stream'
import { RuntimeSubscriptionRegistry } from '../../runtime/client/runtime-subscription-registry'
import {
  createHostFile,
  listHostDirPage,
  machineHostFileSystem,
  readHostChunk,
  removeHostPath,
  requireHostPath,
  writeHostChunk
} from '../../runtime/rpc/methods/machines/machine-host-file-io'
import {
  cancelMachineHostStream,
  runMachineHostUrlDownload,
  runMachineHostWatch,
  type MachineHostSubscriptions
} from '../../runtime/rpc/methods/machines/machine-host-streams'
import {
  resizeMachineHostShell,
  runMachineHostShell,
  writeMachineHostShell
} from '../../runtime/rpc/methods/machines/machine-host-shell'
import type { RemoteCommandChannel } from '../../managed-server/install/remote-install-transport'
import {
  MachineHostCancel,
  MachineHostCreateFile,
  MachineHostDownloadUrl,
  MachineHostExec,
  MachineHostListDir,
  MachineHostPath,
  MachineHostReadChunk,
  MachineHostRename,
  MachineHostShell,
  MachineHostShellInput,
  MachineHostShellResize,
  MachineHostWatch,
  MachineHostWriteChunk
} from '../../../shared/rpc-contract/machine-host-params'
import type { MachineHostStreamEvent } from '../../../shared/machines/machine-host-wire'
import { collectLocalMachineMetrics } from '../metrics/local-machine-metrics'
import { runLiveSessionHostScript } from '../../live-sessions/hosts/live-session-host-run'
import { LiveSessionHostRunParams } from '../../../shared/live-sessions/live-session-rpc-params'
import { runLocalShellScript } from '../exec/local-shell-exec'
import { MACHINE_HOST_EXEC_MAX_OUTPUT_BYTES } from '../../../shared/machines/machine-host-limits'
import type { RuntimeMachineChannel } from '../runtime/runtime-machine-channel'
import type { SshMachineLink } from '../connection/ssh-machine-link'
import type { SshExecOptions } from '../../ssh/connection/ssh-exec-options'
import { wrapRemoteCommandForPosixShell } from '../../ssh/remote-exec/ssh-posix-command-wrapper'
import type { MachineConnection } from '../connection/machine-connection'
import { openLocalPty } from '../connection/local-machine-shell'
import { ServerMachineConnection } from '../connection/server-machine-connection'
import { SshMachineConnection } from '../connection/ssh-machine-connection'

/** A Seal server on this host: the desktop channel routed straight into the runtime's machineHost handlers. */
export function createInProcessRuntimeChannel(
  registry: RuntimeSubscriptionRegistry = new RuntimeSubscriptionRegistry()
): { channel: RuntimeMachineChannel; emitted: MachineHostStreamEvent[] } {
  const runtime: MachineHostSubscriptions = {
    registerSubscriptionCleanup: (id, cleanup, connectionId) =>
      registry.register(id, cleanup, connectionId),
    cleanupSubscription: (id) => registry.cleanup(id),
    cleanupSubscriptionAndWait: (id) => registry.cleanupAndWait(id)
  }
  const unary: Record<string, (params: unknown) => Promise<unknown>> = {
    'machineHost.metrics': async () => collectLocalMachineMetrics(),
    'machineHost.homeDir': async () => ({ path: os.homedir() }),
    'machineHost.listDir': async (raw) => {
      const p = MachineHostListDir.parse(raw)
      return listHostDirPage(p.path, p.offset, p.limit)
    },
    'machineHost.stat': async (raw) =>
      machineHostFileSystem.stat(requireHostPath(MachineHostPath.parse(raw).path)),
    'machineHost.readChunk': async (raw) => {
      const p = MachineHostReadChunk.parse(raw)
      return readHostChunk(p.path, p.offset, p.length)
    },
    'machineHost.createFile': async (raw) => {
      const p = MachineHostCreateFile.parse(raw)
      await createHostFile(p.path, p.contentBase64)
    },
    'machineHost.writeChunk': async (raw) => {
      const p = MachineHostWriteChunk.parse(raw)
      await writeHostChunk(p.path, p.offset, p.contentBase64)
    },
    'machineHost.createDir': async (raw) =>
      machineHostFileSystem.createDir(requireHostPath(MachineHostPath.parse(raw).path)),
    'machineHost.rename': async (raw) => {
      const p = MachineHostRename.parse(raw)
      await machineHostFileSystem.rename(requireHostPath(p.from), requireHostPath(p.to))
    },
    'machineHost.remove': async (raw) => removeHostPath(MachineHostPath.parse(raw).path),
    'liveSessions.hostRun': async (raw) =>
      runLiveSessionHostScript(LiveSessionHostRunParams.parse(raw)),
    'machineHost.exec': async (raw) => {
      const p = MachineHostExec.parse(raw)
      return runLocalShellScript(p.script, {
        timeoutMs: p.timeoutMs,
        maxOutputBytes: MACHINE_HOST_EXEC_MAX_OUTPUT_BYTES,
        ...(p.cwd ? { cwd: requireHostPath(p.cwd) } : {}),
        ...(p.stdinBase64 !== undefined ? { stdin: Buffer.from(p.stdinBase64, 'base64') } : {})
      })
    },
    'machineHost.shellInput': async (raw) => {
      const p = MachineHostShellInput.parse(raw)
      return writeMachineHostShell(p.subscriptionId, p.dataBase64)
    },
    'machineHost.shellResize': async (raw) => {
      const p = MachineHostShellResize.parse(raw)
      return resizeMachineHostShell(p.subscriptionId, p.cols, p.rows)
    },
    'machineHost.cancel': async (raw) =>
      cancelMachineHostStream(runtime, MachineHostCancel.parse(raw).subscriptionId)
  }
  const emitted: MachineHostStreamEvent[] = []
  let connectionSeq = 0
  const channel: RuntimeMachineChannel = {
    async call(method, params) {
      const handler = unary[method]
      if (!handler) {
        throw new Error(`Unexpected method ${method}`)
      }
      return handler(params)
    },
    async stream(method, raw, handlers) {
      const connectionId = `conn-${++connectionSeq}`
      const emit = (event: MachineHostStreamEvent): void => {
        emitted.push(event)
        handlers.onEvent(event)
      }
      const ctx = { runtime, connectionId }
      let run: Promise<void>
      if (method === 'machineHost.watch') {
        run = runMachineHostWatch(MachineHostWatch.parse(raw).dirs, ctx, emit)
      } else if (method === 'machineHost.shell') {
        const p = MachineHostShell.parse(raw)
        run = runMachineHostShell(
          { ...p, ...(p.cwd ? { cwd: requireHostPath(p.cwd) } : {}) },
          ctx,
          emit
        )
      } else {
        const p = MachineHostDownloadUrl.parse(raw)
        run = runMachineHostUrlDownload(p.url, p.destination, ctx, emit)
      }
      void run.then(handlers.onClose, (error: unknown) => handlers.onError(String(error)))
      // Closing the subscription socket is what retires a stream on a real runtime.
      return { close: () => registry.cleanupForConnection(connectionId) }
    }
  }
  return { channel, emitted }
}

/** A system-ssh command channel whose "remote" is this host's login shell: `close` carries the exit code. */
class LoopbackCommandChannel extends Duplex implements RemoteCommandChannel {
  readonly stdin: Writable
  readonly stderr: Readable
  private readonly child: ChildProcessWithoutNullStreams

  constructor(shell: string, command: string, env: NodeJS.ProcessEnv) {
    super({ emitClose: false })
    this.child = spawn(shell, ['-c', command], { env })
    this.stdin = this.child.stdin
    this.stderr = this.child.stderr
    this.child.stdin.on('error', () => {})
    this.child.stdout.on('data', (chunk: Buffer) => {
      if (!this.push(chunk)) {
        this.child.stdout.pause()
      }
    })
    this.child.on('close', (code) => {
      this.push(null)
      this.emit('close', code ?? 255)
    })
  }

  override _read(): void {
    this.child.stdout.resume()
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.child.stdin.write(chunk, done)
  }

  override _final(done: (error?: Error | null) => void): void {
    this.child.stdin.end(done)
  }

  close(): void {
    this.child.kill()
  }
}

/** An SSH host that is this machine: sshd hands each command to the user's login shell, here `loginShell`. */
export function createLoopbackSshLink(loginShell = '/bin/sh'): SshMachineLink {
  // Same wrapping the real transport applies, so the login shell only parses what sshd would hand it.
  const exec = async (command: string, options?: SshExecOptions) =>
    new LoopbackCommandChannel(
      loginShell,
      options?.wrapCommand === false
        ? command
        : wrapRemoteCommandForPosixShell(command, { compress: options?.compressCommand === true }),
      process.env
    )
  return {
    exec,
    usesSystemSshTransport: () => true,
    getConnectGeneration: () => 1,
    getState: () => ({ status: 'connected', remotePlatform: 'linux' }),
    sftp: () => Promise.reject(new Error('system ssh has no SFTP channel')),
    shell: () => Promise.reject(new Error('system ssh shells run in a local PTY')),
    async writeBuffer(remotePath, contents, options) {
      await mkdir(path.dirname(remotePath), { recursive: true })
      await (options?.append ? appendFile(remotePath, contents) : writeFile(remotePath, contents))
    },
    downloadFile: async (remotePath, localPath) => {
      await mkdir(path.dirname(localPath), { recursive: true })
      await copyFile(remotePath, localPath)
    },
    openFileUploadSession: async () => ({
      async uploadFile(localPath, remotePath) {
        await mkdir(path.dirname(remotePath), { recursive: true })
        await copyFile(localPath, remotePath)
      },
      close: () => {}
    })
  }
}

/** A machine reached over SSH that is this host; its terminals start in `$HOME`. */
export function createLoopbackSshConnection(loginShell = '/bin/sh'): MachineConnection {
  const link = createLoopbackSshLink(loginShell)
  return new SshMachineConnection('machine:loop-ssh', {
    link: () => link,
    connect: async () => {},
    // Mirrors system ssh: `ssh -t` lands in a login shell, then the prelude is typed into it.
    openSystemShell: async (prelude, options, handlers) => {
      const shell = await openLocalPty(
        { file: '/bin/sh', args: [], cwd: process.env.HOME ?? os.homedir() },
        options,
        handlers
      )
      if (prelude) {
        shell.write(`${prelude}\n`)
      }
      return shell
    }
  })
}

/** A machine reached through a Seal server that is this host. */
export function createInProcessServerConnection(
  channel: RuntimeMachineChannel = createInProcessRuntimeChannel().channel
): MachineConnection {
  return new ServerMachineConnection('machine:loop-server', {
    channel,
    isConnected: () => true,
    connect: async () => {}
  })
}
