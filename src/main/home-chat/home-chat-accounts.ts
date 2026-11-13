import type { HomeChatAccountOption } from '../../shared/home-chat/home-chat-types'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'

/** The seam seal/multi-account's vault plugs into; null always means the default Claude login. */
export type HomeChatAccountProvider = {
  list: () => Promise<HomeChatAccountOption[]>
  /** CLAUDE_CONFIG_DIR for the account, or null to run on the default login. */
  claudeConfigDir: (accountId: string | null) => Promise<string | null>
}

/** Backed by Orca's saved Claude accounts until the Seal vault lands. */
export function createClaudeAccountsProvider(source: {
  listAccounts: () => ClaudeRateLimitAccountsState
}): HomeChatAccountProvider {
  return {
    list: () => {
      const state = source.listAccounts()
      return Promise.resolve([
        {
          id: null,
          label: 'Default login',
          ...(state.systemDefaultEmail ? { detail: state.systemDefaultEmail } : {})
        },
        ...state.accounts
          .filter((account) => !account.needsSignIn)
          .map((account) => ({
            id: account.id,
            label: account.email,
            ...(account.organizationName ? { detail: account.organizationName } : {})
          }))
      ])
    },
    claudeConfigDir: (accountId) => {
      if (accountId === null) {
        return Promise.resolve(null)
      }
      const account = source.listAccounts().accounts.find((a) => a.id === accountId)
      if (!account) {
        return Promise.reject(new Error('That Claude account was removed. Pick another account.'))
      }
      return Promise.resolve(account.runsOnSystemDefault ? null : (account.home ?? null))
    }
  }
}
