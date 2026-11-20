import { ACCOUNT_READ_FLOOR_MS, failureBackoffMs } from './service-types'

type Attempt = { at: number; failures: number }

/**
 * The one budget for usage requests about an account that is not the host's selection. Every
 * caller draws on it, so a switcher opening beside Seal's poller and a refresh still costs the
 * endpoint one request.
 */
export class AccountReadAdmission {
  private readonly attempts = new Map<string, Attempt>()

  /** Whether a request for this account may go out now; a granted one is counted. */
  admit(slot: string, now: number): boolean {
    const last = this.attempts.get(slot)
    const waitMs = Math.max(
      ACCOUNT_READ_FLOOR_MS,
      last?.failures ? failureBackoffMs(last.failures) : 0
    )
    if (last && now - last.at < waitMs) {
      return false
    }
    this.attempts.set(slot, { at: now, failures: last?.failures ?? 0 })
    return true
  }

  /** Failed requests back off; a good reading clears the backoff. */
  settle(slot: string, succeeded: boolean): void {
    const last = this.attempts.get(slot)
    if (last) {
      last.failures = succeeded ? 0 : last.failures + 1
    }
  }

  /** A new login makes the account's attempts obsolete. */
  forget(slot: string): void {
    this.attempts.delete(slot)
  }
}
