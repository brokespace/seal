import type { HomeChatAccountOption } from '../../shared/home-chat/home-chat-types'
import type {
  ClaudeRateLimitAccountsState,
  CodexManagedAccount
} from '../../shared/managed-account-types'

/** The accounts a thread can answer with; a null id always means the provider's default login. */
export type HomeChatAccountProvider = {
  list: () => Promise<HomeChatAccountOption[]>
  /** CLAUDE_CONFIG_DIR for the account, or null to run on the default login. */
  claudeConfigDir: (accountId: string | null) => Promise<string | null>
  /** CODEX_HOME for the account, or null to run on the default login. */
  codexHome: (accountId: string | null) => Promise<string | null>
}

/** Backed by the Claude and Codex logins saved in Seal. */
export function createHomeChatAccountProvider(source: {
  listClaudeAccounts: () => ClaudeRateLimitAccountsState
  listCodexAccounts: () => readonly CodexManagedAccount[]
}): HomeChatAccountProvider {
  // A WSL-only login cannot run a process on this host.
  const codexAccounts = (): CodexManagedAccount[] =>
    source.listCodexAccounts().filter((account) => account.managedHomeRuntime !== 'wsl')
  return {
    list: () => {
      const claude = source.listClaudeAccounts()
      return Promise.resolve([
        {
          backend: 'claude-code' as const,
          id: null,
          label: 'Default login',
          ...(claude.systemDefaultEmail ? { detail: claude.systemDefaultEmail } : {})
        },
        ...claude.accounts
          .filter((account) => !account.needsSignIn)
          .map((account) => ({
            backend: 'claude-code' as const,
            id: account.id,
            label: account.email,
            ...(account.organizationName ? { detail: account.organizationName } : {})
          })),
        { backend: 'codex' as const, id: null, label: 'Default login' },
        ...codexAccounts().map((account) => ({
          backend: 'codex' as const,
          id: account.id,
          label: account.email,
          ...(account.workspaceLabel ? { detail: account.workspaceLabel } : {})
        }))
      ])
    },
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
      const account = codexAccounts().find((a) => a.id === accountId)
      return account
        ? Promise.resolve(account.managedHomePath)
        : Promise.reject(new Error('That Codex account was removed. Pick another account.'))
    }
  }
}
