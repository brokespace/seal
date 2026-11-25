import { MACHINE_HOST_EXEC_MAX_TIMEOUT_MS } from '../../../shared/machines/machine-host-limits'
import {
  parseMachineExecResult,
  type MachineExecResult
} from '../../../shared/machines/machine-host-wire'
import type { MachineIdentity } from '../../../shared/machines/machine-record'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'
import { RuntimeMachineFileSystem } from '../runtime/runtime-machine-filesystem'
import type { RuntimeMachineChannel } from '../runtime/runtime-machine-channel'
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

const RPC_SLACK_MS = 10_000
const SHELL_START_TIMEOUT_MS = 20_000
const SHELL_CALL_TIMEOUT_MS = 15_000
const IDENTITY_TIMEOUT_MS = 15_000

function abortError(): Error {
  const error = new Error('Cancelled')
  error.name = 'AbortError'
  return error
}

export type ServerMachineConnectionDeps = {
  channel: RuntimeMachineChannel
  isConnected: () => boolean
  connect: () => Promise<void>
}

/** A machine reached through its paired Seal server over the runtime RPC channel. */
export class ServerMachineConnection implements MachineConnection {
  readonly transport = 'server'
  readonly files: MachineFileSystem
  private readonly runtimeFiles: RuntimeMachineFileSystem
  private platform: Promise<MachineShellDialect> | null = null

  constructor(
    readonly machineId: MachineId,
    private readonly deps: ServerMachineConnectionDeps
  ) {
    this.runtimeFiles = new RuntimeMachineFileSystem(machineId, deps.channel)
    this.files = withPollingWatch(this.runtimeFiles)
  }

  isConnected(): boolean {
    return this.deps.isConnected()
  }

  async connect(): Promise<void> {
    if (!this.isConnected()) {
      await this.deps.connect()
    }
  }

  dialect(): Promise<MachineShellDialect> {
    this.platform ??= this.metrics().then(
      (metrics) => (metrics.os === 'win32' ? 'powershell' : 'posix'),
      (error: unknown) => {
        this.platform = null
        throw error
      }
    )
    return this.platform
  }

  async exec(script: string, options: MachineExecOptions): Promise<MachineExecResult> {
    if (options.signal?.aborted) {
      throw abortError()
    }
    // The server accepts 1s..1h; longer work belongs in a background job.
    const timeoutMs = Math.min(Math.max(options.timeoutMs, 1_000), MACHINE_HOST_EXEC_MAX_TIMEOUT_MS)
    const call = this.deps.channel
      .call(
        'machineHost.exec',
        {
          script,
          timeoutMs,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.stdin !== undefined
            ? { stdinBase64: Buffer.from(options.stdin).toString('base64') }
            : {})
        },
        timeoutMs + RPC_SLACK_MS
      )
      .then(parseMachineExecResult)
    const signal = options.signal
    if (!signal) {
      return call
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => reject(abortError())
      signal.addEventListener('abort', onAbort, { once: true })
      call.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  metrics(): Promise<MachineMetrics> {
    return this.runtimeFiles.metrics()
  }

  async identity(): Promise<MachineIdentity> {
    const result = await this.exec(machineIdentityScript(await this.dialect()), {
      timeoutMs: IDENTITY_TIMEOUT_MS
    })
    return parseMachineIdentity(result.stdout)
  }

  async openShell(
    options: MachineShellOptions,
    handlers: MachineShellHandlers
  ): Promise<MachineShell> {
    const channel = this.deps.channel
    let subscriptionId: string | null = null
    let ended = false
    let resolveStart: ((id: string) => void) | null = null
    let rejectStart: ((error: Error) => void) | null = null
    const started = new Promise<string>((resolve, reject) => {
      resolveStart = resolve
      rejectStart = reject
    })
    const finish = (exitCode: number | null): void => {
      if (!ended) {
        ended = true
        handlers.onExit(exitCode)
      }
    }
    const stream = await channel.stream('machineHost.shell', options, {
      onEvent: (event) => {
        switch (event.type) {
          case 'starting':
            subscriptionId = event.subscriptionId
            resolveStart?.(event.subscriptionId)
            break
          case 'data':
            handlers.onData(Buffer.from(event.dataBase64, 'base64').toString('utf8'))
            break
          case 'exit':
            finish(event.exitCode)
            break
          case 'end':
            finish(null)
            break
          case 'error':
            rejectStart?.(new Error(event.message))
            finish(null)
            break
          case 'change':
          case 'progress':
          case 'done':
          case 'cancelled':
            break
        }
      },
      onError: (message) => {
        rejectStart?.(new Error(message))
        finish(null)
      },
      onClose: () => {
        rejectStart?.(new Error('The Seal server closed the terminal'))
        finish(null)
      }
    })
    const timeout = setTimeout(
      () => rejectStart?.(new Error('The Seal server did not start the terminal')),
      SHELL_START_TIMEOUT_MS
    )
    try {
      await started
    } catch (error) {
      stream.close()
      throw error
    } finally {
      clearTimeout(timeout)
    }
    // Unary calls can overtake each other; one chain keeps keystrokes in order.
    let queue: Promise<unknown> = Promise.resolve()
    const send = (method: string, params: Record<string, unknown>): void => {
      if (ended || !subscriptionId) {
        return
      }
      const id = subscriptionId
      queue = queue
        .then(() => channel.call(method, { subscriptionId: id, ...params }, SHELL_CALL_TIMEOUT_MS))
        .catch(() => {})
    }
    return {
      write: (data) =>
        send('machineHost.shellInput', { dataBase64: Buffer.from(data).toString('base64') }),
      resize: (cols, rows) => send('machineHost.shellResize', { cols, rows }),
      close: () => {
        if (ended || !subscriptionId) {
          return
        }
        const id = subscriptionId
        void queue
          .then(() =>
            channel.call('machineHost.cancel', { subscriptionId: id }, SHELL_CALL_TIMEOUT_MS)
          )
          .catch(() => {})
          .finally(() => stream.close())
      }
    }
  }
}
