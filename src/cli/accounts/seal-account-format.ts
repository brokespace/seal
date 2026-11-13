import type { SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import type {
  SealAccountCandidate,
  SealUsageWindow
} from '../../shared/seal-accounts/seal-account-candidates'
import type { SealAccountsStatus } from '../../shared/seal-accounts/seal-accounts-status'
import type { SealLaunchPick } from '../../shared/seal-accounts/seal-launch-account-pick'

function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 48) {
    return `${hours}h ${minutes % 60}m`
  }
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

function formatWindow(name: string, window: SealUsageWindow | null, now: number): string {
  if (!window) {
    return `${name}   —`
  }
  const used = window.resetsAt !== null && window.resetsAt <= now ? 0 : window.usedPercent
  const reset =
    window.resetsAt && window.resetsAt > now ? ` (${formatDuration(window.resetsAt - now)})` : ''
  return `${name} ${String(Math.round(used)).padStart(3)}%${reset}`
}

function flags(candidate: SealAccountCandidate, status: SealAccountsStatus, now: number): string {
  const marks = [
    candidate.active ? '*' : ' ',
    candidate.authFailure ? '!' : ' ',
    (status.quarantine[candidate.key]?.until ?? 0) > now ? 'q' : ' '
  ]
  return marks.join('')
}

export function formatCandidate(
  candidate: SealAccountCandidate,
  status: SealAccountsStatus,
  now: number
): string {
  const head = `${flags(candidate, status, now)} ${candidate.label.padEnd(18)} `
  if (candidate.kind === 'api-key') {
    const entry = status.config.apiKeys.find((key) => key.id === candidate.localId)
    return `${head}API key ${entry?.keyHint ?? ''}${candidate.launchable ? '' : ' (not in this keychain)'}`
  }
  const usage = candidate.usage
  const models = (usage?.models ?? []).map((model) => formatWindow(model.name, model, now))
  const extras = [
    candidate.disabled ? 'disabled' : null,
    candidate.launchable ? null : 'not signed in here',
    usage?.error ? `usage: ${usage.error}` : null
  ].filter(Boolean)
  return [
    head + (candidate.email ?? '').padEnd(28),
    (candidate.plan ?? '').padEnd(6),
    formatWindow('5h', usage?.session ?? null, now),
    formatWindow('7d', usage?.weekly ?? null, now),
    ...models,
    ...extras
  ].join('  ')
}

export function formatProviderStatus(
  provider: SealProvider,
  status: SealAccountsStatus,
  now: number
): string {
  const settings = status.config.autoSwap[provider]
  const providerStatus = status.providers[provider]
  const header = `${provider} on ${status.machineKey} — auto-swap ${settings.enabled ? 'on' : 'off'} · ${settings.strategy} · 5h ${settings.sessionThreshold}% / 7d ${settings.weeklyThreshold}%`
  const rows = providerStatus.candidates.map((candidate) => formatCandidate(candidate, status, now))
  const lines = [header, ...(rows.length > 0 ? rows : ['   (no accounts)'])]
  if (providerStatus.lastDecision) {
    lines.push(`   last check: ${providerStatus.lastDecision.summary}`)
  }
  return lines.join('\n')
}

export function formatPick(pick: SealLaunchPick): string {
  const head =
    pick.kind === 'account'
      ? `${pick.candidate.label} (${pick.candidate.key}) — ${pick.reason}`
      : 'The host’s selected account (no Seal rule applies)'
  return [head, ...pick.warnings.map((warning) => `  warning: ${warning}`)].join('\n')
}

export function formatPolicies(status: SealAccountsStatus): string {
  const describe = (policy: { allow?: string[]; default?: string | null } | undefined) =>
    policy
      ? `allow ${policy.allow?.length ? policy.allow.join(', ') : 'any'}${policy.default ? `, default ${policy.default}` : ''}`
      : null
  const lines: string[] = []
  for (const rule of status.config.projects) {
    const parts = [`claude: ${describe(rule.claude)}`, `codex: ${describe(rule.codex)}`].filter(
      (part) => !part.endsWith('null')
    )
    lines.push(`project ${rule.match}${rule.label ? ` (${rule.label})` : ''}  ${parts.join('  ')}`)
  }
  for (const rule of status.config.machines) {
    const parts = [`claude: ${describe(rule.claude)}`, `codex: ${describe(rule.codex)}`].filter(
      (part) => !part.endsWith('null')
    )
    lines.push(
      `machine ${rule.machine}${rule.label ? ` (${rule.label})` : ''}  ${parts.join('  ')}`
    )
  }
  return lines.length > 0 ? lines.join('\n') : 'No project or machine rules.'
}

export function formatSessions(status: SealAccountsStatus): string {
  if (status.sessions.length === 0) {
    return 'No sessions recorded yet.'
  }
  return status.sessions
    .slice(-30)
    .toReversed()
    .map((session) => {
      const when = new Date(session.at).toLocaleString()
      const where = session.projectLabel ?? session.worktreeId ?? 'no workspace'
      return `${when}  ${session.provider.padEnd(6)} ${session.accountLabel.padEnd(18)} ${session.reason.padEnd(16)} ${where}`
    })
    .join('\n')
}
