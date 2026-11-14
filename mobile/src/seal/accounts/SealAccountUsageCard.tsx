import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { ProviderUsageWindows } from '../../accounts/ProviderUsageWindows'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { sealRateLimitText, sealSwapEstimateText } from './seal-account-presentation'
import type { SealCandidate } from './seal-accounts-schemas'

/** One account: its name, whether new sessions use it, the accounts tab's usage bars, and the next-swap estimate. */
export function SealAccountUsageCard({
  candidate,
  now,
  compact = false,
  children
}: {
  candidate: SealCandidate
  now: number
  /** Leaves out the estimate, for the overview. */
  compact?: boolean
  children?: ReactNode
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const limits = candidate.limits ?? null
  const name = candidate.label || candidate.email || candidate.key
  const meta = [
    candidate.plan,
    candidate.email && candidate.email !== name ? candidate.email : null
  ].filter(Boolean)
  const note = candidate.authFailure
    ? t('seal.accounts.authFailure', 'Signed out; sign in again on your computer.')
    : candidate.disabled
      ? t('seal.accounts.disabled', 'Turned off for auto-swap')
      : (sealRateLimitText(candidate, now) ?? limits?.error)
  const estimate = compact ? null : sealSwapEstimateText(candidate, now)
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {candidate.active ? (
          <Text style={styles.badge}>{t('seal.accounts.active', 'In use')}</Text>
        ) : null}
      </View>
      {meta.length > 0 ? (
        <Text style={styles.meta} numberOfLines={1}>
          {meta.join(' · ')}
        </Text>
      ) : null}
      {candidate.kind === 'api-key' ? (
        <Text style={styles.meta}>{t('seal.accounts.apiKey', 'API key; no usage windows')}</Text>
      ) : (
        <ProviderUsageWindows
          limits={limits}
          now={now}
          isFetching={candidate.usageFetching}
          showEmptyWindows
        />
      )}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      {estimate ? <Text style={styles.meta}>{estimate}</Text> : null}
      {children}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  card: {
    borderRadius: radii.surface,
    backgroundColor: colors.sheetGroup,
    padding: spacing.lg,
    gap: spacing.xs,
    marginBottom: spacing.sm
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    flexShrink: 1,
    fontSize: typography.bodySize + 2,
    fontWeight: '600',
    color: colors.textPrimary
  },
  badge: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.statusGreen,
    backgroundColor: colors.choiceSelectedFill,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden'
  },
  meta: { fontSize: typography.metaSize, color: colors.textSecondary },
  note: { fontSize: typography.metaSize, color: colors.statusAmber }
}))
