import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { getOptionalStringFlag } from '../arguments/flags'
import { resolveLaunchUserDataPath } from '../runtime/profile/launch-user-data-path'
import { RuntimeClientError, RuntimeRpcFailureError } from '../runtime/connection/types'
import {
  PAIRED_DEVICES_LIST_METHOD,
  PAIRED_DEVICES_REVOKE_METHOD,
  type PairedDevicesListResult,
  type PairedDevicesRevokeParams,
  type PairedDevicesRevokeResult
} from '../../shared/paired-device-admin-contract'
import { formatPairedDevices, formatRevokedDevices } from './paired-devices-format'

/** Where the answer came from: `offline` changed only the files, to be finished by the next start. */
export type PairedDevicesSource = 'running' | 'offline'

type UnderLock<T> =
  | { status: 'done'; value: T }
  | { status: 'missing' }
  | { status: 'running'; message: string }

function isRuntimeNotRunning(error: unknown): boolean {
  // A refusal from a running Orca is an answer; only an unreachable one falls back to the files.
  return (
    error instanceof RuntimeClientError &&
    !(error instanceof RuntimeRpcFailureError) &&
    error.code === 'runtime_unavailable'
  )
}

function offlineValue<T>(result: UnderLock<T>, userDataPath: string, empty: T): T {
  if (result.status === 'missing') {
    return empty
  }
  if (result.status === 'running') {
    throw new RuntimeClientError(
      'runtime_unavailable',
      `An Orca holds the profile at ${userDataPath} but did not answer. Nothing was changed; try again once it responds, or stop it first. ${result.message}`
    )
  }
  return result.value
}

async function onRunningOrcaOrFiles<T>(
  ctx: HandlerContext,
  method: string,
  params: unknown,
  offline: (userDataPath: string) => Promise<T>
): Promise<{ source: PairedDevicesSource; result: T }> {
  if (ctx.client.isRemote) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Paired devices are managed on the machine that runs Orca, not through a pairing. Run this command there.'
    )
  }
  try {
    return { source: 'running', result: (await ctx.client.call<T>(method, params)).result }
  } catch (error) {
    if (!isRuntimeNotRunning(error)) {
      throw error
    }
  }
  return { source: 'offline', result: await offline(resolveLaunchUserDataPath()) }
}

function print<T>(
  ctx: HandlerContext,
  answer: { source: PairedDevicesSource; result: T },
  format: (result: T, source: PairedDevicesSource) => string
): void {
  console.log(
    ctx.json
      ? JSON.stringify({ ok: true, result: { ...answer.result, source: answer.source } }, null, 2)
      : format(answer.result, answer.source)
  )
}

export const PAIRED_DEVICES_HANDLERS: Record<string, CommandHandler> = {
  'devices list': async (ctx) => {
    const answer = await onRunningOrcaOrFiles<PairedDevicesListResult>(
      ctx,
      PAIRED_DEVICES_LIST_METHOD,
      {},
      async (userDataPath) => {
        // Lazy: only the offline path needs orcad's lock and registry code.
        const { listPairedDevicesUnderLock } =
          await import('../../main/orcad/profile-state/paired-devices-under-lock.js')
        return offlineValue(listPairedDevicesUnderLock(userDataPath), userDataPath, { devices: [] })
      }
    )
    print(ctx, answer, formatPairedDevices)
  },
  'devices revoke': async (ctx) => {
    const deviceId = getOptionalStringFlag(ctx.flags, 'device')
    const all = ctx.flags.get('all') === true
    if (all === (deviceId !== undefined)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Name one device (`orca devices revoke <deviceId>`; see `orca devices list`) or pass --all.'
      )
    }
    const params: PairedDevicesRevokeParams = all ? { all: true } : { deviceIds: [deviceId!] }
    const answer = await onRunningOrcaOrFiles<PairedDevicesRevokeResult>(
      ctx,
      PAIRED_DEVICES_REVOKE_METHOD,
      params,
      async (userDataPath) => {
        const { revokePairedDevicesUnderLock } =
          await import('../../main/orcad/profile-state/paired-devices-under-lock.js')
        return offlineValue(revokePairedDevicesUnderLock(userDataPath, params), userDataPath, {
          revoked: [],
          notFound: params.deviceIds ?? []
        })
      }
    )
    print(ctx, answer, formatRevokedDevices)
    if (answer.result.notFound.length > 0) {
      process.exitCode = 1
    }
  }
}
