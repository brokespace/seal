import { useCallback, useMemo, useSyncExternalStore } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealProvider } from '../../../../shared/seal-accounts/seal-accounts-config'
import {
  sealAccountSwitchView,
  type SealAccountSwitchView
} from '../../../../shared/seal-accounts/seal-account-switch-view'
import { sealHostSnapshot, subscribeSealHost } from '../seal-session/seal-session-status-store'

/** Undefined until the host has answered, so the switcher keeps its own labels meanwhile. */
export function useSealStatusSwitchView(
  target: RuntimeClientTarget,
  provider: SealProvider
): SealAccountSwitchView | undefined {
  const subscribe = useCallback(
    (listener: () => void) => subscribeSealHost(target, listener),
    [target]
  )
  const candidates = useSyncExternalStore(subscribe, () => sealHostSnapshot(target))?.status
    .providers[provider].candidates
  return useMemo(() => (candidates ? sealAccountSwitchView(candidates) : undefined), [candidates])
}
