import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { callRuntimeRpc } from '@/runtime/rpc/calls/runtime-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-activity/window-visibility-interval'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import type {
  SealConnectorsConfig,
  SealConnectorsFleetHost,
  SealConnectorsFleetStatus,
  SealConnectorsHostStatus
} from '../../../../../shared/seal-connectors/seal-connectors-types'

const POLL_MS = 30_000
const RPC_TIMEOUT_MS = 30_000

export const LOCAL_CONNECTORS_TARGET: RuntimeClientTarget = { kind: 'local' }

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught)
}

/** Where to call a host the fleet lists: `local` is this desktop, any other target is a paired server. */
export function connectorsHostTarget(
  host: Pick<SealConnectorsFleetHost, 'target'>
): RuntimeClientTarget {
  return host.target === 'local'
    ? LOCAL_CONNECTORS_TARGET
    : { kind: 'environment', environmentId: host.target }
}

export function connectorsCall<T>(
  method: string,
  params: unknown = {},
  options: { target?: RuntimeClientTarget; timeoutMs?: number } = {}
): Promise<T> {
  return callRuntimeRpc<T>(options.target ?? LOCAL_CONNECTORS_TARGET, method, params, {
    timeoutMs: options.timeoutMs ?? RPC_TIMEOUT_MS
  })
}

export type SealConnectors = {
  /** Null until this desktop's own host answered. */
  status: SealConnectorsHostStatus | null
  config: SealConnectorsConfig | null
  fleet: SealConnectorsFleetStatus | null
  error: string | null
  loading: boolean
  /** When status was last read; every age and expiry is judged against it. */
  readAt: number
  refresh: () => Promise<void>
  /** Shows the edit at once, saves it, and re-reads on failure. Resolves to whether it saved. */
  editConfig: (edit: (config: SealConnectorsConfig) => SealConnectorsConfig) => Promise<boolean>
  setRefresher: (hostKey: string | null) => Promise<boolean>
}

type Snapshot = Pick<SealConnectors, 'status' | 'config' | 'fleet' | 'error' | 'loading' | 'readAt'>

/** One poller serves every mounted view: N hooks cost one status read per interval. */
let snapshot: Snapshot = {
  status: null,
  config: null,
  fleet: null,
  error: null,
  loading: true,
  readAt: 0
}
const listeners = new Set<() => void>()
let stopPolling: (() => void) | null = null
let inFlight: Promise<void> | null = null
let latestConfig: SealConnectorsConfig | null = null
let saving = 0
let saveQueue: Promise<unknown> = Promise.resolve()

function publish(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) {
    listener()
  }
}

async function readAll(): Promise<void> {
  const [own, all] = await Promise.allSettled([
    connectorsCall<SealConnectorsHostStatus>('seal.connectors.status'),
    connectorsCall<SealConnectorsFleetStatus>(
      'seal.connectors.fleetStatus',
      {},
      { timeoutMs: 60_000 }
    )
  ])
  const patch: Partial<Snapshot> = { readAt: Date.now(), loading: false }
  if (own.status === 'fulfilled') {
    patch.status = own.value
    patch.error = null
    if (saving === 0) {
      latestConfig = own.value.config
      patch.config = own.value.config
    }
  } else {
    patch.error = errorText(own.reason)
  }
  if (all.status === 'fulfilled') {
    patch.fleet = all.value
  }
  publish(patch)
}

function refreshAll(): Promise<void> {
  inFlight ??= readAll().finally(() => {
    inFlight = null
  })
  return inFlight
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void refreshAll()
    stopPolling = installWindowVisibilityInterval({
      run: () => void refreshAll(),
      intervalMs: POLL_MS,
      slowWhileUnfocused: true
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopPolling?.()
      stopPolling = null
    }
  }
}

function saveConfig(
  edit: (config: SealConnectorsConfig) => SealConnectorsConfig,
  failure: string
): Promise<boolean> {
  const base = latestConfig
  if (!base) {
    return Promise.resolve(false)
  }
  const next = edit(base)
  latestConfig = next
  publish({ config: next })
  saving += 1
  const run = async (): Promise<boolean> => {
    try {
      await connectorsCall('seal.connectors.setConfig', { base, config: next })
      return true
    } catch (caught) {
      toast.error(failure, { description: errorText(caught) })
      return false
    } finally {
      saving -= 1
      if (saving === 0) {
        await refreshAll()
      }
    }
  }
  const result = saveQueue.then(run, run)
  saveQueue = result
  return result
}

async function designateRefresher(hostKey: string | null, failure: string): Promise<boolean> {
  try {
    await connectorsCall('seal.connectors.setRefresher', { hostKey })
    await refreshAll()
    return true
  } catch (caught) {
    toast.error(failure, { description: errorText(caught) })
    return false
  }
}

/** The central connector list, this host's sign-in status and every machine's, shared by every page that shows them. */
export function useSealConnectors(failure = 'Could not update connectors'): SealConnectors {
  const current = useSyncExternalStore(subscribe, () => snapshot)
  const editConfig = useCallback<SealConnectors['editConfig']>(
    (edit) => saveConfig(edit, failure),
    [failure]
  )
  const setRefresher = useCallback(
    (hostKey: string | null) => designateRefresher(hostKey, failure),
    [failure]
  )
  return useMemo(
    () => ({ ...current, refresh: refreshAll, editConfig, setRefresher }),
    [current, editConfig, setRefresher]
  )
}
