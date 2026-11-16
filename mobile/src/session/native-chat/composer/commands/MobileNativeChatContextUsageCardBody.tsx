import { Text, View } from 'react-native'
import {
  keyContextUsageRows,
  type NativeChatContextUsageSummary
} from '../../../../../../src/shared/native-chat/native-chat-context-usage-summary'
import {
  isContextUsageMeasured,
  type NativeChatContextUsageReadout
} from '../../../../../../src/shared/native-chat/native-chat-context-usage-state'
import type { Translate } from '../../../../i18n/mobile-i18n'
import { useMobileTranslation } from '../../../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../../../theme/mobile-theme'
import { themedStyleSheet } from '../../../../theme/themed-styles'
import { useMobileColorScheme } from '../../../../theme/use-mobile-color-scheme'
import { formatTimeAgo } from '../../../../worktree/agent-lineage/agent-row-display'

function compactionLine(
  usage: NativeChatContextUsageSummary,
  now: number,
  t: Translate
): string | null {
  const count = usage.compactions ?? 0
  const at = usage.lastCompactedAt
  // A host clock ahead of this one reads as just now, which takes no "ago".
  const ago =
    at === undefined
      ? null
      : now - at < 60_000
        ? formatTimeAgo(at, now)
        : t('seal.contextIndicator.ago', '{{time}} ago', { time: formatTimeAgo(at, now) })
  if (count > 0 && ago !== null) {
    return count === 1
      ? t(
          'seal.contextIndicator.compactedCountLast_one',
          'Compacted {{count}} time, last {{ago}}',
          {
            count,
            ago
          }
        )
      : t(
          'seal.contextIndicator.compactedCountLast_other',
          'Compacted {{count}} times, last {{ago}}',
          { count, ago }
        )
  }
  if (count > 0) {
    return count === 1
      ? t('seal.contextIndicator.compactedCount_one', 'Compacted {{count}} time', { count })
      : t('seal.contextIndicator.compactedCount_other', 'Compacted {{count}} times', { count })
  }
  return ago === null
    ? null
    : t('seal.contextIndicator.lastCompacted', 'Last compacted {{ago}}', { ago })
}

/** What the context card says under its title. `warnTint` is the ring's colour once it warns. */
export function MobileNativeChatContextUsageCardBody({
  usage,
  readout,
  now,
  warnTint
}: {
  usage: NativeChatContextUsageSummary
  readout: NativeChatContextUsageReadout
  now: number
  warnTint: string | null
}): React.JSX.Element {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const compaction = compactionLine(usage, now, t)
  const compactionText = compaction ? <Text style={styles.detail}>{compaction}</Text> : null
  if (!isContextUsageMeasured(usage)) {
    return (
      <>
        <Text style={styles.detail}>
          {t('seal.contextIndicator.empty', 'Context usage appears after the first reply.')}
        </Text>
        {compactionText}
      </>
    )
  }
  const figures = { used: readout.used, window: readout.window, percent: String(usage.percentage) }
  return (
    <>
      <Text style={styles.usage}>
        {usage.estimated
          ? t(
              'seal.contextIndicator.usageAbout',
              'About {{used}} of {{window}} tokens ({{percent}}%)',
              figures
            )
          : t(
              'seal.contextIndicator.usage',
              '{{used}} of {{window}} tokens ({{percent}}%)',
              figures
            )}
      </Text>
      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            warnTint ? { backgroundColor: warnTint } : null,
            { width: `${readout.filled}%` }
          ]}
        />
      </View>
      {usage.model ? (
        <Text style={styles.model} numberOfLines={1}>
          {usage.model}
        </Text>
      ) : null}
      {readout.compactsAt !== undefined && readout.left !== undefined ? (
        <Text style={[styles.detail, warnTint ? [styles.emphasis, { color: warnTint }] : null]}>
          {t(
            'seal.contextIndicator.compactsAt',
            'Compacts automatically at {{threshold}}: {{left}} left',
            { threshold: readout.compactsAt, left: readout.left }
          )}
        </Text>
      ) : null}
      {compactionText}
      {usage.rows.length > 0 ? (
        <View style={styles.rows}>
          {keyContextUsageRows(usage.rows).map(({ key, row }) => (
            <View key={key} style={styles.row}>
              <Text style={styles.rowName} numberOfLines={1}>
                {row.name}
              </Text>
              <Text style={styles.rowValue}>{row.percentage}%</Text>
            </View>
          ))}
        </View>
      ) : null}
      {usage.estimated ? (
        <Text style={styles.estimated}>
          {t('chat.contextUsage.estimated', 'Estimated from the last response.')}
        </Text>
      ) : null}
    </>
  )
}

const styles = themedStyleSheet(() => ({
  usage: {
    marginTop: spacing.xs,
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontVariant: ['tabular-nums']
  },
  track: {
    height: 6,
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.textPrimary
  },
  model: {
    marginTop: spacing.sm,
    color: colors.textMuted,
    fontSize: typography.metaSize
  },
  detail: {
    marginTop: spacing.xs,
    color: colors.textSecondary,
    fontSize: typography.metaSize
  },
  emphasis: {
    fontWeight: '600'
  },
  rows: {
    marginTop: spacing.md,
    gap: spacing.xs
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md
  },
  rowName: {
    flexShrink: 1,
    color: colors.textPrimary,
    fontSize: typography.metaSize
  },
  rowValue: {
    color: colors.textMuted,
    fontSize: typography.metaSize,
    fontVariant: ['tabular-nums']
  },
  estimated: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: typography.metaSize
  }
}))
