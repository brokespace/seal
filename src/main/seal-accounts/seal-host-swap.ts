import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealSwapEvent } from '../../shared/seal-accounts/seal-accounts-status'
import type { SealAccountManager } from './seal-account-manager'

export type SealSwapQuarantineUpdate = (
  state: { quarantine: Record<string, { until: number; reason: string }> },
  at: number
) => void

/** Moves this host's selected login and logs it; running sessions keep the login they have. */
export async function recordSealHostSwap(
  manager: Pick<SealAccountManager, 'services' | 'store' | 'candidates' | 'now'>,
  provider: SealProvider,
  to: SealAccountCandidate,
  reason: SealSwapEvent['reason'],
  updateQuarantine: SealSwapQuarantineUpdate
): Promise<SealSwapEvent> {
  if (to.kind === 'api-key') {
    throw new Error(
      'API keys and setup tokens run per session or workspace, not as the machine’s selected login.'
    )
  }
  const from = manager.candidates(provider).find((entry) => entry.active)?.key ?? null
  await (provider === 'claude'
    ? manager.services.claudeAccounts.selectAccount(to.localId)
    : manager.services.codexAccounts.selectAccount(to.localId))
  const event: SealSwapEvent = {
    at: manager.now(),
    provider,
    from,
    to: to.key,
    toLabel: to.label,
    reason
  }
  manager.store.updateState((next) => {
    updateQuarantine(next, event.at)
    next.lastSwapAt[provider] = event.at
    next.swapLog.push(event)
  })
  console.log(`[seal-accounts] ${provider}: switched to ${to.label} (${reason})`)
  return event
}
