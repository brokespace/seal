import { stat } from 'node:fs/promises'
import type { MachineFileSystem } from '../../machines/filesystem/machine-filesystem'
import type { RuntimeHostStatusSnapshot } from '../../../shared/remote-runtime/host-status/runtime-host-status'
import { MACHINE_HOST_EXEC_MAX_TIMEOUT_MS } from '../../../shared/machines/machine-host-limits'
import {
  decodeBase64File,
  parseLoadProbe,
  posixLoadProbeScript,
  powerShellLoadProbeScript,
  readFileBase64Script,
  writeFromStdinScript
} from './home-chat-machine-scripts'
import type {
  HomeChatExecOptions,
  HomeChatExecResult,
  HomeChatMachine,
  HomeChatMachineInfo,
  HomeChatShellDialect
} from './home-chat-machine-types'

/** Machines paired through a Seal server rather than SSH: everything goes over the server's RPC socket. */
export type HomeChatRuntimeSource = {
  environments: () => { id: string; name: string; sshAccess?: { sshTargetId: string } }[]
  statuses: () => RuntimeHostStatusSnapshot[]
  call: (
    environmentId: string,
    method: string,
    params: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  fileSystem: (environmentId: string) => MachineFileSystem
}

const RPC_GRACE_MS = 15_000
const OUTDATED_HINT =
  'The Seal server on this machine is older than the assistant and cannot run commands for it yet. Update Seal on that machine (Machines page), or add the machine as an SSH host.'

function isExecResult(value: unknown): value is HomeChatExecResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'stdout' in value &&
    'stderr' in value &&
    'timedOut' in value
  )
}

function abortable<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) {
    return work
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('Cancelled'))
    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

export function createRuntimeMachine(
  info: HomeChatMachineInfo,
  environmentId: string,
  source: HomeChatRuntimeSource
): HomeChatMachine {
  const dialect: HomeChatShellDialect = info.platform === 'win32' ? 'powershell' : 'posix'
  const exec = async (
    script: string,
    options: HomeChatExecOptions
  ): Promise<HomeChatExecResult> => {
    const timeoutMs = Math.min(Math.max(options.timeoutMs, 1_000), MACHINE_HOST_EXEC_MAX_TIMEOUT_MS)
    const call = source
      .call(
        environmentId,
        'machineHost.exec',
        {
          script,
          timeoutMs,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.stdin !== undefined
            ? { stdinBase64: Buffer.from(options.stdin).toString('base64') }
            : {})
        },
        timeoutMs + RPC_GRACE_MS
      )
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // Older servers answer with the Machines page's "update" message or an unknown-method error.
        throw new Error(
          /update seal|unknown method|method_not_found/i.test(message) ? OUTDATED_HINT : message
        )
      })
    const result = await abortable(call, options.signal)
    if (!isExecResult(result)) {
      throw new Error(`${info.label} returned an unreadable command result`)
    }
    return result
  }
  const quiet = (script: string, stdin?: string): Promise<HomeChatExecResult> =>
    exec(script, { timeoutMs: 60_000, ...(stdin !== undefined ? { stdin } : {}) })
  const transfer = async (
    run: (session: Awaited<ReturnType<MachineFileSystem['openTransferSession']>>) => Promise<void>
  ): Promise<void> => {
    const session = await source
      .fileSystem(environmentId)
      .openTransferSession(new AbortController().signal)
    try {
      await run(session)
    } finally {
      session.close()
    }
  }
  return {
    info,
    dialect,
    exec,
    readTextFile: async (path, maxBytes) => {
      const result = await quiet(readFileBase64Script(dialect, path, maxBytes))
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `could not read ${path}`)
      }
      return decodeBase64File(result.stdout, maxBytes)
    },
    writeTextFile: async (path, content, { append }) => {
      const result = await quiet(writeFromStdinScript(dialect, path, append), content)
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `could not write ${path}`)
      }
    },
    downloadTo: async (remotePath, localPath) => {
      const { size } = await source.fileSystem(environmentId).stat(remotePath)
      await transfer((session) => session.downloadFile(remotePath, localPath, size, () => {}))
    },
    uploadFrom: async (localPath, remotePath) => {
      const { size } = await stat(localPath)
      await transfer((session) => session.uploadFile(localPath, remotePath, size, () => {}))
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
