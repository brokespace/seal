import type { SealAccountCandidate } from './seal-account-candidates'
import type { SealProvider } from './seal-accounts-config'

/** How Settings > Accounts names a host's accounts, so every account switcher lists the same rows. */
export type SealAccountSwitchView = {
  /** The machine's own CLI login as a row of its own; null when Seal does not list one. */
  systemLogin: { label: string } | null
  /** Seal's name for each saved account, by the id the host's account service knows it by. */
  labels: Record<string, string>
}

export type SealAccountSwitchViews = Record<SealProvider, SealAccountSwitchView>

export function sealAccountSwitchView(
  candidates: readonly SealAccountCandidate[]
): SealAccountSwitchView {
  const view: SealAccountSwitchView = { systemLogin: null, labels: {} }
  for (const candidate of candidates) {
    if (candidate.kind === 'system') {
      view.systemLogin = { label: candidate.label }
    } else if (candidate.kind === 'oauth' && candidate.localId) {
      view.labels[candidate.localId] = candidate.label
    }
  }
  return view
}

/** Whether a switcher lists the machine's own login as a row of its own. */
export function showsSystemLoginRow(
  view: SealAccountSwitchView | undefined,
  activeAccountId: string | null
): boolean {
  // Seal folds the machine's login into its saved twin and hides it once removed from Seal.
  return !view || view.systemLogin !== null || activeAccountId === null
}
