import { translate } from '@/i18n/i18n'
import type { Translate } from '@/i18n/use-translate'
import type { ProviderRateLimits } from '../../../../shared/rate-limit-types'
import { getOwnerNotSetUpLabel, getOwnerNotSetUpNote } from './owner-not-set-up-copy'
import { getProviderUsageStatusLabel } from './usage-error-copy'
import { isUsageSignInRequired } from '../../../../shared/usage-sign-in-required'

export type UsageRosterRowState = {
  kind: 'usage' | 'loading' | 'sign-in' | 'unavailable' | 'error' | 'empty'
  statusLabel: string | null
  /** A second line under the row, for context the label cannot fit. */
  detail?: string | null
}

export function getUsageRosterRowState(
  provider: ProviderRateLimits,
  hasUsage: boolean,
  t: Translate = translate
): UsageRosterRowState {
  if (hasUsage) {
    return { kind: 'usage', statusLabel: null }
  }
  const placeholder = provider.usageMetadata?.ownerNotSetUp
  if (placeholder) {
    return {
      kind: 'unavailable',
      statusLabel: getOwnerNotSetUpLabel(placeholder, t),
      detail: getOwnerNotSetUpNote(placeholder, t)
    }
  }
  if (provider.status === 'idle' || provider.status === 'fetching') {
    return {
      kind: 'loading',
      statusLabel: t('auto.components.status.bar.UsageRosterPanel.loadingUsage', 'Loading usage…')
    }
  }
  if (isUsageSignInRequired(provider)) {
    return {
      kind: 'sign-in',
      statusLabel: t('auto.components.status.bar.UsageRosterPanel.notSignedIn', 'not signed in')
    }
  }
  if (provider.status === 'error') {
    return { kind: 'error', statusLabel: getProviderUsageStatusLabel(provider, t) }
  }
  if (provider.status === 'unavailable') {
    return {
      kind: 'unavailable',
      statusLabel: t(
        'auto.components.status.bar.UsageRosterPanel.usageUnavailable',
        'Usage unavailable'
      )
    }
  }
  return {
    kind: 'empty',
    statusLabel: t('auto.components.status.bar.UsageRosterPanel.noUsageData', 'No usage data')
  }
}
