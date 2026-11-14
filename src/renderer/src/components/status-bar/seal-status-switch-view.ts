import { useMemo } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealProvider } from '../../../../shared/seal-accounts/seal-accounts-config'
import {
  sealAccountSwitchView,
  type SealAccountSwitchView
} from '../../../../shared/seal-accounts/seal-account-switch-view'
import { useSealHostSnapshot } from '../seal-session/use-seal-host-snapshot'

/** Undefined until the host has answered, so the switcher keeps its own labels meanwhile. */
export function useSealStatusSwitchView(
  target: RuntimeClientTarget,
  provider: SealProvider
): SealAccountSwitchView | undefined {
  const candidates = useSealHostSnapshot(target)?.status.providers[provider].candidates
  return useMemo(() => (candidates ? sealAccountSwitchView(candidates) : undefined), [candidates])
}
