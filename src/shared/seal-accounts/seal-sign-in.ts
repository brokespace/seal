import type { SealAccountKey, SealProvider } from './seal-accounts-config'

export type SealSignInMethod = 'browser' | 'device-code'

/** One sign-in Seal runs with the provider's own CLI in an isolated per-account folder. */
export type SealSignInRequest = {
  provider: SealProvider
  /** `browser`: the provider's OAuth page. `device-code`: Codex's code entered on any device. */
  method: SealSignInMethod
  /** Let the CLI open the page on the machine running it; off for a host with no screen. */
  openBrowser: boolean
  /** Re-login: the account that is expected to sign in again. */
  account?: SealAccountKey
}

export type SealSignInOutcome = {
  accountKey: SealAccountKey
  label: string
  email: string | null
  /** `refreshed`: the login already existed and now holds the new tokens. */
  outcome: 'added' | 'refreshed'
  /** A re-login that signed in as someone else: the account it was started for. */
  expected?: string
}
