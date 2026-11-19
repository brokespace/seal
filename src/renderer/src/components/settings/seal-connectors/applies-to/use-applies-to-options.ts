import { useMemo } from 'react'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import { SEAL_PROVIDERS } from '../../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealConnectorsFleetStatus } from '../../../../../../shared/seal-connectors/seal-connectors-types'
import { useLocalSealAccounts } from '../../../live-sessions/menu/live-session-accounts'

export type AppliesToOption = {
  id: string
  label: string
}

export type AppliesToOptions = {
  machines: AppliesToOption[]
  accounts: AppliesToOption[]
  harnesses: AppliesToOption[]
}

/** Every machine, account and agent a scope can name; ones a saved scope names but Seal no longer sees are added by the editor. */
export function useAppliesToOptions(fleet: SealConnectorsFleetStatus | null): AppliesToOptions {
  const snapshot = useLocalSealAccounts()
  return useMemo(() => {
    const machines = (fleet?.hosts ?? []).flatMap((host) =>
      host.status?.hostKey ? [{ id: host.status.hostKey, label: host.label }] : []
    )
    const accounts = SEAL_PROVIDERS.flatMap((provider) =>
      (snapshot?.status.providers[provider].candidates ?? [])
        .filter((candidate) => candidate.kind !== 'api-key')
        .map((candidate) => ({ id: candidate.key, label: candidate.label }))
    )
    const harnesses = getAgentCatalog().map((entry) => ({ id: entry.id, label: entry.label }))
    return { machines, accounts, harnesses }
  }, [fleet, snapshot])
}

export function appliesToLabel(options: readonly AppliesToOption[], id: string): string {
  return options.find((option) => option.id === id)?.label ?? id
}
