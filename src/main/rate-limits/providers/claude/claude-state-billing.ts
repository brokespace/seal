import { readFile } from 'node:fs/promises'
import { z } from 'zod'
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

const stateSchema = z.object({
  oauthAccount: z
    .object({ emailAddress: z.unknown().optional(), billingType: z.unknown().optional() })
    .optional()
    .catch(undefined),
  primaryApiKey: z.unknown().optional()
})

export function claudeStateBilling(state: unknown): ClaudeStateBilling {
  const parsed = stateSchema.safeParse(state)
  const record = parsed.success ? parsed.data : {}
  const account = record.oauthAccount
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
