import { useCallback, useSyncExternalStore } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  sealHostSnapshot,
  sealHostState,
  subscribeSealHost,
  type SealHostSnapshot,
  type SealHostState
} from './seal-session-status-store'

const NO_TARGET: SealHostState = { snapshot: null, error: null, refreshing: false }

function useSealHostSubscription(target: RuntimeClientTarget | null) {
  return useCallback(
    (listener: () => void) => (target ? subscribeSealHost(target, listener) : () => {}),
    [target]
  )
}

/** A host's shared account status, with whether it is being re-read and why a read failed. */
export function useSealHostState(target: RuntimeClientTarget | null): SealHostState {
  const subscribe = useSealHostSubscription(target)
  return useSyncExternalStore(subscribe, () => (target ? sealHostState(target) : NO_TARGET))
}

/** A host's shared account status; null until it has answered, or with no host to ask. */
export function useSealHostSnapshot(target: RuntimeClientTarget | null): SealHostSnapshot | null {
  const subscribe = useSealHostSubscription(target)
  return useSyncExternalStore(subscribe, () => (target ? sealHostSnapshot(target) : null))
}
