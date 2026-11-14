import { readFile } from 'node:fs/promises'
import type { ClaudeBillingSignals } from '../../../../shared/claude-account-billing'
import { claudeStateFileAsync } from '../../../claude-accounts/sign-in/claude-account-folder'

export type ClaudeStateBilling = {
  /** `.claude.json` names an `oauthAccount`: someone signed in here with a Claude or Console login. */
  signedIn: boolean
  signals: ClaudeBillingSignals
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function claudeStateBilling(state: unknown): ClaudeStateBilling {
  const record = state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
  const account =
    record.oauthAccount && typeof record.oauthAccount === 'object'
      ? (record.oauthAccount as Record<string, unknown>)
      : null
  return {
    signedIn: Boolean(text(account?.emailAddress)),
    signals: {
      billingType: text(account?.billingType),
      // A Console login leaves the API key it minted here instead of an OAuth token.
      ...(text(record.primaryApiKey) ? { apiKey: true } : {})
    }
  }
}

/** What the login's own `.claude.json` says about billing, for a login with no readable token. */
export async function readClaudeStateBilling(
  userConfigDir: string | undefined
): Promise<ClaudeStateBilling> {
  try {
    const file = await claudeStateFileAsync(userConfigDir)
    return claudeStateBilling(JSON.parse(await readFile(file, 'utf8')))
  } catch {
    return { signedIn: false, signals: {} }
  }
}
