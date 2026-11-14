import type { HomeChatAccountOption } from '../../shared/home-chat/home-chat-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexManagedAccount
} from '../../shared/managed-account-types'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'

/** The accounts a thread can answer with; a null id always means this computer's own CLI login. */
export type HomeChatAccountProvider = {
  list: () => Promise<HomeChatAccountOption[]>
  /** CLAUDE_CONFIG_DIR for the account, or null to run on this computer's own `claude` login. */
  claudeConfigDir: (accountId: string | null) => Promise<string | null>
  /** CODEX_HOME for the account, or null to run on this computer's own `codex` login. */
  codexHome: (accountId: string | null) => Promise<string | null>
}

const BACKENDS = [
  { backend: 'claude-code', provider: 'claude' },
  { backend: 'codex', provider: 'codex' }
] as const

function identityDetail(candidate: SealAccountCandidate): string | undefined {
  const parts = [candidate.email, candidate.orgName].filter(
    (part): part is string => Boolean(part) && part !== candidate.label
  )
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** A saved login a chat can run on by its own folder; keys and tokens need a launch env. */
function isSavedLogin(candidate: SealAccountCandidate): boolean {
  return (
    candidate.kind === 'oauth' &&
    candidate.localId !== null &&
    // The system login is already offered under the null id; its saved twin would repeat it.
    !candidate.systemLogin &&
    candidate.launchable &&
    !candidate.disabled &&
    candidate.health?.state !== 'dead'
  )
}

/** Home chat picks from the same Claude and Codex accounts Settings > Accounts lists. */
export function createHomeChatAccountProvider(source: {
  /** Seal's accounts for a provider, or null before the account manager has started. */
  sealCandidates: (provider: SealProvider) => SealAccountCandidate[] | null
  listClaudeAccounts: () => ClaudeRateLimitAccountsState
  listCodexAccounts: () => readonly CodexManagedAccount[]
}): HomeChatAccountProvider {
  return {
    list: () =>
      Promise.resolve(
        BACKENDS.flatMap(({ backend, provider }) => {
          const candidates = source.sealCandidates(provider) ?? []
          const system = candidates.find((candidate) => candidate.systemLogin)
          return [
            {
              backend,
              id: null,
              label: 'System login',
              ...(system ? { detail: system.label } : {})
            },
            ...candidates.filter(isSavedLogin).map((candidate) => {
              const detail = identityDetail(candidate)
              return {
                backend,
                id: candidate.localId,
                label: candidate.label,
                ...(detail ? { detail } : {})
              }
            })
          ]
        })
      ),
    claudeConfigDir: (accountId) => {
      if (accountId === null) {
        return Promise.resolve(null)
      }
      const account = source.listClaudeAccounts().accounts.find((a) => a.id === accountId)
      if (!account) {
        return Promise.reject(new Error('That Claude account was removed. Pick another account.'))
      }
      return Promise.resolve(account.runsOnSystemDefault ? null : (account.home ?? null))
    },
    codexHome: (accountId) => {
      if (accountId === null) {
        return Promise.resolve(null)
      }
      // A WSL-only login cannot run a process on this host.
      const account = source
        .listCodexAccounts()
        .find((a) => a.id === accountId && a.managedHomeRuntime !== 'wsl')
      return account
        ? Promise.resolve(account.managedHomePath)
        : Promise.reject(new Error('That Codex account was removed. Pick another account.'))
    }
  }
}
