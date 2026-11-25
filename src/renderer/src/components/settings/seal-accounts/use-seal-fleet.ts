import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import {
  buildSealFleetOverview,
  type SealFleetOverview
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { useSealAccounts, type SealAccountsMutation } from './use-seal-accounts'

const REMOTE_POLL_MS = 60_000
const REMOTE_TIMEOUT_MS = 20_000

/** Another machine that can hold copies of accounts. */
export type SealRemoteMachine = {
  /** The paired server's environment id, or the `machine:` id of one reached over SSH only. */
  id: string
  label: string
  /** Set when it has no Seal server to ask: it only takes pushed logins. */
  loginsOnly?: { connected: boolean }
}

type RemoteReading = { status: SealAccountsStatus | null; error: string | null }

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

async function readRemote(machine: SealRemoteMachine): Promise<RemoteReading> {
  if (machine.loginsOnly) {
    return { status: null, error: null }
  }
  try {
    const status = await callRuntimeRpc<SealAccountsStatus>(
      { kind: 'environment', environmentId: machine.id },
      'seal.accounts.status',
      { refreshUsage: false },
      { timeoutMs: REMOTE_TIMEOUT_MS }
    )
    return { status, error: null }
  } catch (caught) {
    return { status: null, error: errorText(caught) }
  }
}

export type SealFleet = {
  /** Null until the home machine answered. */
  overview: SealFleetOverview | null
  status: SealAccountsStatus | null
  readAt: number
  error: string | null
  refreshing: boolean
  refresh: (refreshUsage?: boolean) => Promise<void>
  mutate: SealAccountsMutation
  /** Runs a change on another machine, then re-reads it. */
  mutateOn: (
    machineId: string,
    method: string,
    params: unknown,
    failure: string
  ) => Promise<boolean>
  reloadMachines: () => Promise<void>
}

/** Accounts on the home machine plus every other machine's copies, read live. `remotes` must be stable. */
export function useSealFleet(
  home: RuntimeClientTarget,
  homeLabel: string,
  remotes: readonly SealRemoteMachine[]
): SealFleet {
  const accounts = useSealAccounts(home)
  const [readings, setReadings] = useState<Record<string, RemoteReading>>({})

  const reloadMachines = useCallback(async () => {
    const results = await Promise.all(remotes.map(readRemote))
    setReadings(Object.fromEntries(remotes.map((machine, index) => [machine.id, results[index]])))
  }, [remotes])

  const poll = useEffectEvent(() => void reloadMachines())
  useEffect(() => {
    poll()
    return installWindowVisibilityInterval({
      run: poll,
      intervalMs: REMOTE_POLL_MS,
      slowWhileUnfocused: true
    })
  }, [remotes])

  const { refresh: refreshHome } = accounts
  const refresh = useCallback(
    async (refreshUsage = false) => {
      await Promise.all([refreshHome(refreshUsage), reloadMachines()])
    },
    [refreshHome, reloadMachines]
  )

  const mutateOn = useCallback<SealFleet['mutateOn']>(
    async (machineId, method, params, failure) => {
      try {
        await callRuntimeRpc<unknown>(
          { kind: 'environment', environmentId: machineId },
          method,
          params,
          {
            timeoutMs: 60_000
          }
        )
        await reloadMachines()
        return true
      } catch (caught) {
        toast.error(failure, { description: errorText(caught) })
        return false
      }
    },
    [reloadMachines]
  )

  const overview = useMemo(
    () =>
      accounts.status
        ? buildSealFleetOverview([
            { id: 'local', label: homeLabel, home: true, status: accounts.status, error: null },
            ...remotes.map((machine) => ({
              id: machine.id,
              label: machine.label,
              home: false,
              status: readings[machine.id]?.status ?? null,
              error: readings[machine.id]?.error ?? null,
              loginsOnly: machine.loginsOnly
            }))
          ])
        : null,
    [accounts.status, homeLabel, readings, remotes]
  )

  return { ...accounts, overview, refresh, mutateOn, reloadMachines }
}
