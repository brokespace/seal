import { create } from 'zustand'
import { useAppStore } from '@/store'
import type { SealAccountKey } from '../../../../../shared/seal-accounts/seal-accounts-config'

/** The account whose sign-in the Accounts page should open on its next render. */
export const useSealReloginRequest = create<{ accountKey: SealAccountKey | null }>(() => ({
  accountKey: null
}))

/** Settings > Accounts, where Seal's account vault lives. */
export function openAccountsSettings(): void {
  // Setting a target alone only queues the deep link; the page must be opened too.
  const state = useAppStore.getState()
  state.openSettingsTarget({ pane: 'accounts', repoId: null })
  state.openSettingsPage()
}

/** The one way to sign a Seal account in again: opens Accounts on that account's sign-in. */
export function requestSealRelogin(accountKey: SealAccountKey): void {
  useSealReloginRequest.setState({ accountKey })
  openAccountsSettings()
}

export function clearSealReloginRequest(): void {
  useSealReloginRequest.setState({ accountKey: null })
}
