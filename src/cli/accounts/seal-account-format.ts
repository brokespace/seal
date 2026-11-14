import type {
  SealAccountsStatus,
  SealSessionSwapEntry
} from '../../shared/seal-accounts/seal-accounts-status'
import type { SealLaunchPick } from '../../shared/seal-accounts/seal-launch-account-pick'

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

const DELIVERY_TEXT: Record<SealSessionSwapEntry['delivery'], string> = {
  live: 'switched live',
  resume: 'resumed on it',
  failed: 'could not switch'
}

export function formatSwapEntry(entry: SealSessionSwapEntry): string {
  const when = new Date(entry.at).toLocaleTimeString()
  const note = entry.note ? ` — ${entry.note}` : ''
  return `${when}  ${entry.fromLabel} → ${entry.toLabel} (${entry.reason}, ${DELIVERY_TEXT[entry.delivery]})${note}`
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
      const state = session.endedAt ? 'closed' : session.profileHome ? 'live-swap' : 'open'
      const head = `${session.id.slice(0, 8)}  ${when}  ${session.provider.padEnd(6)} ${session.accountLabel.padEnd(18)} ${state.padEnd(9)} ${where}`
      const history = (session.history ?? []).map((entry) => `    ${formatSwapEntry(entry)}`)
      return [head, ...history].join('\n')
    })
    .join('\n')
}
