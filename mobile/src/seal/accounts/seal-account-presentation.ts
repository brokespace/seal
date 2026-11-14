import { formatResetDuration } from '../../../../src/shared/rate-limit-reset-format'
import { windowPct } from '../../../../src/shared/seal-accounts/seal-usage-lines'
import { translate } from '../../i18n/mobile-i18n'
import type { LiveSession } from '../live-sessions/live-session-schemas'
import type {
  SealAccountsStatusRead,
  SealCandidate,
  SealLiveSwapMode,
  SealSessionAssignmentRead,
  SealUsageWindowRead
} from './seal-accounts-schemas'

export function sealProviderLabel(provider: string): string {
  switch (provider) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    default:
      return provider
  }
}

/** Percent of a window used as of `now`; a window past its reset counts as empty. */
export function sealWindowUsedPercent(
  window: SealUsageWindowRead | null | undefined,
  now: number
): number | null {
  return window ? Math.round(windowPct(window, now)) : null
}

export function sealResetText(window: SealUsageWindowRead | null | undefined, now: number) {
  if (!window?.resetsAt || window.resetsAt <= now) {
    return null
  }
  return translate('seal.accounts.resetsIn', 'Resets in {{value0}}', {
    value0: formatResetDuration(window.resetsAt - now)
  })
}

/** The account first, then the rest in host order, so the one new sessions use leads. */
export function orderedSealCandidates(candidates: readonly SealCandidate[]): SealCandidate[] {
  return [...candidates.filter((c) => c.active), ...candidates.filter((c) => !c.active)]
}

/** Can become the account new sessions use: a working subscription login on this host. */
export function canUseSealCandidate(candidate: SealCandidate): boolean {
  return (
    candidate.launchable &&
    !candidate.active &&
    !candidate.authFailure &&
    candidate.kind !== 'api-key'
  )
}

/** Accounts a running session can move to: live subscription logins that launch on its host. */
export function sealSessionSwapTargets(
  session: Pick<SealSessionAssignmentRead, 'provider'>,
  candidates: readonly SealCandidate[]
): SealCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.provider === session.provider &&
      candidate.kind !== 'api-key' &&
      candidate.launchable &&
      !candidate.disabled &&
      !candidate.authFailure
  )
}

/** The account record of a live session Seal launched in one of its panes, while that pane is open. */
export function sealAssignmentForLiveSession(
  status: SealAccountsStatusRead | null | undefined,
  session: LiveSession
): SealSessionAssignmentRead | null {
  if (!status) {
    return null
  }
  const paneKeys = new Set(
    session.inputRoutes.flatMap((route) =>
      route.kind === 'seal-pane' && route.paneKey ? [route.paneKey] : []
    )
  )
  if (paneKeys.size === 0) {
    return null
  }
  let newest: SealSessionAssignmentRead | null = null
  for (const entry of status.sessions) {
    if (
      entry.provider === session.provider &&
      !entry.endedAt &&
      entry.paneKey &&
      paneKeys.has(entry.paneKey) &&
      (!newest || entry.at > newest.at)
    ) {
      newest = entry
    }
  }
  return newest
}

/** Seal-launched sessions whose pane is still open, newest first. */
export function openSealAssignments(
  status: SealAccountsStatusRead | null | undefined
): SealSessionAssignmentRead[] {
  return (status?.sessions ?? []).filter((entry) => !entry.endedAt).sort((a, b) => b.at - a.at)
}

export function sealSwapEstimateText(candidate: SealCandidate, now: number): string | null {
  const estimate = candidate.swapEstimate
  if (estimate) {
    return estimate.at <= now
      ? translate('seal.accounts.estimate.now', 'Over its {{value0}} limit; swapping', {
          value0: estimate.window
        })
      : translate(
          'seal.accounts.estimate.at',
          'Next swap ~{{value0}} ({{value1}} reaches {{value2}}%)',
          {
            value0: formatResetDuration(estimate.at - now),
            value1: estimate.window,
            value2: estimate.line
          }
        )
  }
  return candidate.active && candidate.nextPollAt
    ? translate('seal.accounts.estimate.none', 'No swap expected before reset')
    : null
}

export function sealLiveSwapLabel(mode: SealLiveSwapMode): string {
  switch (mode) {
    case 'inherit':
      return translate('seal.accounts.liveSwap.inherit', 'Follow the global setting')
    case 'on':
      return translate('seal.accounts.liveSwap.on', 'Always move this session')
    case 'off':
      return translate('seal.accounts.liveSwap.off', 'Never move this session')
  }
}
