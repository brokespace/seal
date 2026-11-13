import * as z from 'zod'
import type { QueryClient } from '@tanstack/react-query'
import type { SealProvider } from '../../../../src/shared/seal-accounts/seal-accounts-config'
import { defineHostQuery } from '../../query/host-query'
import { hostQueryKey, type HostQueryTarget } from '../../query/host-query-key'
import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { UnvalidatedRpcRequestPort } from '../../transport/rpc/unvalidated-rpc-request-port'
import {
  sealAccountsStatusSchema,
  type SealAccountsStatusRead,
  type SealLiveSwapMode
} from './seal-accounts-schemas'

const readStatus = defineRpcOperation({
  name: 'seal-accounts.status',
  method: 'seal.accounts.status',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('status', sealAccountsStatusSchema)
})

const setAutoSwap = defineRpcOperation({
  name: 'seal-accounts.set-auto-swap',
  method: 'seal.accounts.setAutoSwap',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('status', sealAccountsStatusSchema)
})

const swapAccount = defineRpcOperation({
  name: 'seal-accounts.swap',
  method: 'seal.accounts.swap',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('swapped', z.looseObject({ status: sealAccountsStatusSchema }))
})

const swapSession = defineRpcOperation({
  name: 'seal-accounts.swap-session',
  method: 'seal.accounts.swapSession',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('swapped', z.looseObject({ status: sealAccountsStatusSchema }))
})

const setSessionLiveSwap = defineRpcOperation({
  name: 'seal-accounts.set-session-live-swap',
  method: 'seal.accounts.setSessionLiveSwap',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('status', sealAccountsStatusSchema)
})

type Port = UnvalidatedRpcRequestPort

export const SEAL_ACCOUNTS_TARGET: HostQueryTarget = { exec: 'local' }
const NO_INPUT = {}

export const sealAccountsStatusQuery = defineHostQuery<typeof NO_INPUT, SealAccountsStatusRead>({
  family: 'seal.accounts.status',
  fetch: (client) => runRpcOperation(client, readStatus, { refreshUsage: false }),
  staleTime: 15_000,
  gcTime: 10 * 60_000
})

export const SEAL_ACCOUNTS_INPUT = NO_INPUT

export const sealAccountsStatusKey = (hostId: string) =>
  hostQueryKey(hostId, sealAccountsStatusQuery.family, SEAL_ACCOUNTS_TARGET, NO_INPUT)

/** Asks the host to poll every account's usage first, then answers with the fresh status. */
export function readSealAccountsWithUsage(client: Port): Promise<SealAccountsStatusRead> {
  return runRpcOperation(client, readStatus, { refreshUsage: true })
}

export type SealAccountsMutation =
  | { kind: 'auto-swap'; provider: SealProvider; settings: Record<string, boolean> }
  | { kind: 'swap'; provider: SealProvider; account?: string }
  | { kind: 'swap-session'; sessionId: string; account: string }
  | { kind: 'session-live-swap'; sessionId: string; mode: SealLiveSwapMode }

/** Every mutation answers with the host's fresh status, which replaces the cached one. */
export async function mutateSealAccounts(
  queryClient: QueryClient,
  host: { hostId: string; client: Port },
  mutation: SealAccountsMutation
): Promise<SealAccountsStatusRead> {
  const { client } = host
  let status: SealAccountsStatusRead
  switch (mutation.kind) {
    case 'auto-swap':
      status = await runRpcOperation(client, setAutoSwap, {
        provider: mutation.provider,
        settings: mutation.settings
      })
      break
    case 'swap':
      status = (
        await runRpcOperation(client, swapAccount, {
          provider: mutation.provider,
          ...(mutation.account ? { account: mutation.account } : {})
        })
      ).status
      break
    case 'swap-session':
      status = (
        await runRpcOperation(client, swapSession, {
          sessionId: mutation.sessionId,
          account: mutation.account
        })
      ).status
      break
    case 'session-live-swap':
      status = await runRpcOperation(client, setSessionLiveSwap, {
        sessionId: mutation.sessionId,
        mode: mutation.mode
      })
      break
  }
  queryClient.setQueryData(sealAccountsStatusKey(host.hostId), status)
  return status
}
