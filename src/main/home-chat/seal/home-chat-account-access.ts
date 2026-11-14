import type { SealAccountCandidate } from '../../../shared/seal-accounts/seal-account-candidates'
import type { SealProvider } from '../../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountsStatus } from '../../../shared/seal-accounts/seal-accounts-status'
import { clampUsedPercent } from '../../../shared/usage-percentage-display'
import {
  getUsageWindowSections,
  hasUsageData,
  type UsageWindowSection
} from '../../../shared/usage-provider-windows'
import { usageCheckRemark } from '../../../shared/usage-window-text'

/** The slice of Seal's account manager the assistant uses. */
export type HomeChatSealAccounts = {
  status: () => SealAccountsStatus
  refreshUsage: () => Promise<void>
  swapTo: (provider: SealProvider, ref: string) => Promise<{ toLabel: string }>
}

export type HomeChatAccountAccess = {
  /** One readable block per provider: accounts, which is active, usage and resets. */
  usage: (provider: SealProvider | undefined, refresh: boolean) => Promise<string>
  /** Resolves with the label of the account now active. */
  swap: (provider: SealProvider, account: string) => Promise<string>
}

const PROVIDERS: readonly SealProvider[] = ['claude', 'codex']

function describeWindow(section: UsageWindowSection): string {
  const name =
    section.kind === 'bucket'
      ? section.name
      : section.kind === 'fableWeekly'
        ? 'Fable weekly'
        : section.kind
  if (!section.window) {
    return `${name}: unknown`
  }
  const { usedPercent, resetsAt } = section.window
  const reset = resetsAt ? `, resets ${new Date(resetsAt).toISOString()}` : ''
  return `${name}: ${clampUsedPercent(usedPercent)}% used${reset}`
}

export function describeAccount(account: SealAccountCandidate): string {
  const flags = [
    account.active ? 'ACTIVE' : null,
    account.disabled ? 'disabled' : null,
    account.authFailure ? 'needs sign-in' : null,
    account.rateLimit
      ? `RATE LIMITED${account.rateLimit.resetsAt ? ` until ${new Date(account.rateLimit.resetsAt).toISOString()}` : ''}`
      : null,
    account.launchable ? null : 'cannot launch on this machine'
  ].filter(Boolean)
  const limits = account.limits
  const remark = account.authFailure ? null : usageCheckRemark(limits)
  const usage =
    limits && hasUsageData(limits)
      ? [...getUsageWindowSections(limits).map(describeWindow), ...(remark ? [remark] : [])].join(
          '; '
        )
      : (remark ?? 'usage not read yet')
  const plan = account.plan ?? limits?.planType
  return `- ${account.label}${account.email && account.email !== account.label ? ` <${account.email}>` : ''} [key ${account.key}, ${account.kind}${plan ? `, ${plan}` : ''}]${flags.length ? ` (${flags.join(', ')})` : ''}\n  ${usage}`
}

function matchAccount(
  candidates: readonly SealAccountCandidate[],
  query: string
): SealAccountCandidate {
  const wanted = query.trim().toLowerCase()
  const fields = (account: SealAccountCandidate): string[] =>
    [account.key, account.label, account.email ?? '', account.localId ?? ''].map((field) =>
      field.toLowerCase()
    )
  const exact = candidates.filter((account) => fields(account).includes(wanted))
  const matches =
    exact.length > 0
      ? exact
      : candidates.filter((account) => fields(account).some((field) => field.includes(wanted)))
  if (matches.length === 1) {
    return matches[0]
  }
  const known = candidates.map((account) => `${account.label} (${account.key})`).join(', ')
  throw new Error(
    matches.length === 0
      ? `No account matches "${query}". Accounts: ${known || 'none saved'}`
      : `"${query}" matches several accounts: ${matches.map((a) => `${a.label} (${a.key})`).join(', ')}. Use the key.`
  )
}

export function createHomeChatAccountAccess(
  manager: () => HomeChatSealAccounts | null
): HomeChatAccountAccess {
  const require = (): HomeChatSealAccounts => {
    const accounts = manager()
    if (!accounts) {
      throw new Error("Seal's account manager is not running yet; try again in a moment.")
    }
    return accounts
  }
  return {
    usage: async (provider, refresh) => {
      const accounts = require()
      if (refresh) {
        await accounts.refreshUsage()
      }
      const status = accounts.status()
      return (provider ? [provider] : PROVIDERS)
        .map((name) => {
          const { candidates, lastDecision } = status.providers[name]
          const rows = candidates.map(describeAccount).join('\n') || '- no accounts saved'
          const decision = lastDecision
            ? `\nLast automatic decision (${new Date(lastDecision.at).toISOString()}): ${lastDecision.summary}`
            : ''
          return `${name} accounts:\n${rows}${decision}`
        })
        .join('\n\n')
    },
    swap: async (provider, account) => {
      const accounts = require()
      const target = matchAccount(accounts.status().providers[provider].candidates, account)
      if (target.active) {
        return `${target.label} is already the active ${provider} account.`
      }
      const event = await accounts.swapTo(provider, target.key)
      return `${event.toLabel} is now the active ${provider} account; new sessions launch on it.`
    }
  }
}
