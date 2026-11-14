import {
  sealAccountSwitchView,
  type SealAccountSwitchViews
} from '../../shared/seal-accounts/seal-account-switch-view'
import { getSealAccountManager } from './seal-account-manager'

/** Seal's names for this host's Claude and Codex rows; empty before the account manager starts. */
export function sealAccountSwitchViews(): { seal?: SealAccountSwitchViews } {
  const manager = getSealAccountManager()
  if (!manager) {
    return {}
  }
  try {
    return {
      seal: {
        claude: sealAccountSwitchView(manager.baseCandidates('claude')),
        codex: sealAccountSwitchView(manager.baseCandidates('codex'))
      }
    }
  } catch {
    return {}
  }
}
