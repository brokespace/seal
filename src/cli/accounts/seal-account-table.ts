import type { HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { formatAccountsBlock } from './account-list-format'
import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type { SealAccountCandidate } from '../../shared/seal-accounts/seal-account-candidates'
import { formatResetDuration } from '../../shared/rate-limit-reset-format'
import { formatUsageWindowText, usageCheckRemark } from '../../shared/usage-window-text'
import type { SealAccountsStatus } from '../../shared/seal-accounts/seal-accounts-status'
import { sealAccountKeysMatch } from '../../shared/seal-accounts/seal-account-key'

const PROVIDER_TITLES: Record<SealProvider, string> = { claude: 'CLAUDE', codex: 'CODEX' }
const HEADERS = ['', '#', 'ACCOUNT', 'IDENTITY', 'PLAN', 'HEALTH', '5H', '7D', 'SESSIONS', 'NOTES']

function healthCell(candidate: SealAccountCandidate, now: number): string {
  const { health, rateLimit } = candidate
  if (!health || health.state === 'ok') {
    if (!rateLimit) {
      return 'ok'
    }
    return rateLimit.resetsAt === null
      ? 'rate limited'
      : `rate limited (${formatResetDuration(rateLimit.resetsAt - now)})`
  }
  if (health.state === 'expiring') {
    return `expires ${new Date(health.expiresAt).toISOString().slice(0, 10)}`
  }
  return `dead (${health.reason})`
}

function identityCell(candidate: SealAccountCandidate, status: SealAccountsStatus): string {
  if (candidate.kind === 'api-key') {
    const hint = status.config.apiKeys.find((key) => key.id === candidate.localId)?.keyHint
    const kind = candidate.credential === 'setup-token' ? 'setup token' : 'API key'
    return hint ? `${kind} …${hint}` : kind
  }
  return [candidate.email, candidate.orgName].filter(Boolean).join(' · ') || '—'
}

function notesCell(candidate: SealAccountCandidate, status: SealAccountsStatus, now: number) {
  const estimate = candidate.swapEstimate
  const quarantine = status.quarantine[candidate.key]
  return [
    candidate.systemLogin ? 'system login' : null,
    candidate.wslDistro ? `WSL ${candidate.wslDistro}` : null,
    candidate.disabled ? 'manual only' : null,
    quarantine && quarantine.until > now
      ? `paused ${formatResetDuration(quarantine.until - now)}`
      : null,
    estimate
      ? estimate.at <= now
        ? `swap now (${estimate.window} ≥ ${estimate.line}%)`
        : `swap ~${formatResetDuration(estimate.at - now)} (${estimate.window} → ${estimate.line}%)`
      : null,
    candidate.health?.state === 'dead' ? null : usageCheckRemark(candidate.limits)
  ]
    .filter(Boolean)
    .join(', ')
}

function sessionCount(candidate: SealAccountCandidate, status: SealAccountsStatus): string {
  const open = status.sessions.filter(
    (session) =>
      !session.endedAt &&
      session.accountKey !== null &&
      sealAccountKeysMatch(session.accountKey, candidate.key)
  ).length
  return open > 0 ? String(open) : '—'
}

function renderTable(rows: string[][]): string[] {
  const widths = HEADERS.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column].length))
  )
  return [HEADERS, ...rows].map((row) =>
    row
      .map((cell, column) => cell.padEnd(widths[column]))
      .join('  ')
      .trimEnd()
  )
}

function providerSummary(provider: SealProvider, status: SealAccountsStatus): string {
  const settings = status.config.autoSwap[provider]
  return [
    `${PROVIDER_TITLES[provider]} on ${status.machineKey}`,
    `auto-swap ${settings.enabled ? 'on' : 'off'}`,
    `running sessions ${settings.liveSessionSwap === false ? 'stay' : 'move'}`,
    settings.strategy,
    `swap at 5h ${settings.sessionThreshold}% / 7d ${settings.weeklyThreshold}%`,
    `cooldown ${settings.cooldownMinutes}m`
  ].join(' · ')
}

/** One aligned table per provider: the same accounts, in the same order, as Settings > Accounts. */
export function formatSealAccountsTable(
  status: SealAccountsStatus,
  providers: readonly SealProvider[],
  now: number
): string {
  return providers
    .map((provider) => {
      const providerStatus = status.providers[provider]
      const rows = providerStatus.candidates.map((candidate, index) => [
        candidate.active ? '*' : '',
        String(index + 1),
        candidate.label,
        identityCell(candidate, status),
        candidate.plan ?? '—',
        healthCell(candidate, now),
        formatUsageWindowText(candidate.limits?.session, now),
        formatUsageWindowText(candidate.limits?.weekly, now),
        sessionCount(candidate, status),
        notesCell(candidate, status, now)
      ])
      const dismissed = status.systemLogins?.[provider]
      return [
        providerSummary(provider, status),
        ...(rows.length > 0
          ? renderTable(rows)
          : [`  No ${provider} accounts. Add one with \`seal account add --agent ${provider}\`.`]),
        ...(dismissed?.state === 'dismissed'
          ? [
              `  ${dismissed.email} (this machine's ${provider} login) was removed from Seal; \`seal account import --agent ${provider}\` adds it back.`
            ]
          : []),
        ...(providerStatus.lastDecision
          ? [`  last check: ${providerStatus.lastDecision.summary}`]
          : [])
      ].join('\n')
    })
    .join('\n\n')
}

/** Seal's table for a human reader; null for JSON output and for a host without Seal accounts. */
export async function readSealAccountsTable(
  { client, json }: Pick<HandlerContext, 'client' | 'json'>,
  providers: readonly SealProvider[]
): Promise<string | null> {
  if (json) {
    return null
  }
  try {
    const { result } = await client.call<SealAccountsStatus>('seal.accounts.status', {})
    return formatSealAccountsTable(result, providers, Date.now())
  } catch {
    return null
  }
}

type HostAccountsBlock = Parameters<typeof formatAccountsBlock>[1]

/** `account list --agent claude|codex`: Seal's table for people, the host's own snapshot as JSON. */
export async function listSealProviderAccounts(
  ctx: Pick<HandlerContext, 'client' | 'json'>,
  provider: SealProvider
): Promise<void> {
  const response = await ctx.client.call<Record<SealProvider, HostAccountsBlock>>('accounts.list', {
    refreshUsage: false
  })
  const table = await readSealAccountsTable(ctx, [provider])
  printResult(
    { ...response, result: response.result[provider] },
    ctx.json,
    (state) => table ?? formatAccountsBlock(provider === 'claude' ? 'Claude' : 'Codex', state)
  )
}
