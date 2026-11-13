import type { HomeChatAccountOption } from '../../shared/home-chat/home-chat-types'
import type { ClaudeRateLimitAccountsState } from '../../shared/managed-account-types'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'

export type HomeChatAccountProvider = {
  list: () => Promise<HomeChatAccountOption[]>
  /** CLAUDE_CONFIG_DIR for the account, or null to run on this computer's current Claude login. */
  claudeConfigDir: (accountId: string | null) => Promise<string | null>
}

type SealClaudeAccountSource = {
  /** Seal's Claude accounts, or null before the account manager has started. */
  candidates: () => SealAccountCandidate[] | null
  listAccounts: () => ClaudeRateLimitAccountsState
}

function identityDetail(candidate: SealAccountCandidate): string | undefined {
  const parts = [candidate.email, candidate.orgName].filter(
    (part): part is string => Boolean(part) && part !== candidate.label
  )
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** A saved login a chat can run on by its own config dir; keys and tokens need a launch env. */
function isSavedLogin(candidate: SealAccountCandidate): boolean {
  return (
    candidate.kind === 'oauth' &&
    candidate.localId !== null &&
    candidate.launchable &&
    !candidate.disabled &&
    candidate.health?.state !== 'dead'
  )
}

/** Home chat picks from the same Claude accounts Settings > Accounts lists. */
export function createSealClaudeAccountsProvider(
  source: SealClaudeAccountSource
): HomeChatAccountProvider {
  return {
    list: () => {
      const candidates = source.candidates() ?? []
      const current = candidates.find((candidate) => candidate.active)
      return Promise.resolve([
        {
          id: null,
          label: 'Current account',
          ...(current ? { detail: current.label } : {})
        },
        ...candidates.filter(isSavedLogin).map((candidate) => {
          const detail = identityDetail(candidate)
          return { id: candidate.localId, label: candidate.label, ...(detail ? { detail } : {}) }
        })
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
