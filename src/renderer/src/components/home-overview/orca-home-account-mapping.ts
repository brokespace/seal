import type {
  InactiveAccountUsage,
  ProviderRateLimits,
  RateLimitState
} from '../../../../shared/rate-limit-types'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import { hasUsageData } from '../../../../shared/usage-provider-windows'
import type { HomeAccount } from './home-overview-model'

type RateLimitProviderKey = Exclude<
  {
    [K in keyof RateLimitState]: RateLimitState[K] extends ProviderRateLimits | null ? K : never
  }[keyof RateLimitState],
  undefined
>

// Brand names, not translated.
const PROVIDERS: readonly { key: RateLimitProviderKey; brand: string }[] = [
  { key: 'claude', brand: 'Claude' },
  { key: 'codex', brand: 'Codex' },
  { key: 'gemini', brand: 'Gemini' },
  { key: 'antigravity', brand: 'Antigravity' },
  { key: 'cursor', brand: 'Cursor' },
  { key: 'grok', brand: 'Grok' },
  { key: 'opencodeGo', brand: 'OpenCode Go' },
  { key: 'kimi', brand: 'Kimi' },
  { key: 'minimax', brand: 'MiniMax' },
  { key: 'zcode', brand: 'ZCode' },
  { key: 'muse', brand: 'Muse' }
]

export type OrcaAccountSettings = Pick<
  GlobalSettings,
  | 'claudeManagedAccounts'
  | 'activeClaudeManagedAccountId'
  | 'codexManagedAccounts'
  | 'activeCodexManagedAccountId'
>

function shouldListProvider(limits: ProviderRateLimits | null): limits is ProviderRateLimits {
  // Providers the user never set up report idle/unavailable with no usage; listing them is noise.
  if (!limits) {
    return false
  }
  return limits.status === 'ok' || limits.status === 'error' || hasUsageData(limits)
}

function inactiveAccounts(
  provider: 'claude' | 'codex',
  providerLabel: string,
  usage: readonly InactiveAccountUsage[],
  emailsById: ReadonlyMap<string, string>
): HomeAccount[] {
  return usage.map((entry) => ({
    id: `${provider}:${entry.accountId}`,
    provider,
    providerLabel,
    label: emailsById.get(entry.accountId) ?? providerLabel,
    active: false,
    limits: entry.rateLimits,
    fetching: entry.isFetching
  }))
}

/** Active account per provider first, then saved inactive Claude/Codex accounts. */
export function orcaHomeAccounts(
  rateLimits: RateLimitState,
  settings: Partial<OrcaAccountSettings> | null
): HomeAccount[] {
  const claudeEmails = new Map((settings?.claudeManagedAccounts ?? []).map((a) => [a.id, a.email]))
  const codexEmails = new Map((settings?.codexManagedAccounts ?? []).map((a) => [a.id, a.email]))
  const activeLabels: Partial<Record<RateLimitProviderKey, string | undefined>> = {
    claude: settings?.activeClaudeManagedAccountId
      ? claudeEmails.get(settings.activeClaudeManagedAccountId)
      : undefined,
    codex: settings?.activeCodexManagedAccountId
      ? codexEmails.get(settings.activeCodexManagedAccountId)
      : undefined
  }
  const accounts: HomeAccount[] = []
  for (const { key, brand } of PROVIDERS) {
    const limits = rateLimits[key]
    if (!shouldListProvider(limits)) {
      continue
    }
    accounts.push({
      id: `${key}:active`,
      provider: key,
      providerLabel: brand,
      label: activeLabels[key] ?? limits.usageMetadata?.account?.email ?? brand,
      active: true,
      limits,
      fetching: limits.status === 'fetching'
    })
  }
  accounts.push(
    ...inactiveAccounts('claude', 'Claude', rateLimits.inactiveClaudeAccounts, claudeEmails),
    ...inactiveAccounts('codex', 'Codex', rateLimits.inactiveCodexAccounts, codexEmails)
  )
  return accounts
}

/** Session account attribution: the active managed account email per agent type. */
export function orcaActiveAccountsByAgent(
  settings: Partial<OrcaAccountSettings> | null
): Record<string, string | undefined> {
  const find = (
    accounts: readonly { id: string; email: string }[] | undefined,
    id: string | null | undefined
  ): string | undefined => (id ? accounts?.find((account) => account.id === id)?.email : undefined)
  return {
    claude: find(settings?.claudeManagedAccounts, settings?.activeClaudeManagedAccountId),
    codex: find(settings?.codexManagedAccounts, settings?.activeCodexManagedAccountId)
  }
}
