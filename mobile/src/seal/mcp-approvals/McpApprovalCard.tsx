import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { ShieldAlert } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { McpApproval } from './mcp-approval-schemas'

/** One MCP call waiting for an answer: who asks, what it would do, and Deny before Approve. */
export function McpApprovalCard({
  approval,
  now,
  answering,
  error,
  onAnswer
}: {
  approval: McpApproval
  now: number
  /** The answer in flight for this card. */
  answering: 'approve' | 'deny' | null
  error: string | null
  onAnswer: (approved: boolean) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const secondsLeft = Math.max(0, Math.ceil((approval.expiresAt - now) / 1000))
  const busy = answering !== null
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <ShieldAlert size={16} color={colors.statusAmber} />
        <Text style={styles.heading} numberOfLines={1}>
          {approval.machine
            ? t('seal.mcpApprovals.headingOnMachine', '{{value0}} wants {{value1}} on {{value2}}', {
                value0: approval.clientName,
                value1: approval.tool,
                value2: approval.machine
              })
            : t('seal.mcpApprovals.heading', '{{value0}} wants {{value1}}', {
                value0: approval.clientName,
                value1: approval.tool
              })}
        </Text>
      </View>
      {approval.summary ? (
        <Text style={styles.summary} selectable>
          {approval.summary}
        </Text>
      ) : null}
      <Text style={styles.reason}>{approval.reason}</Text>
      <Text style={styles.meta}>
        {approval.transport === 'relay'
          ? t(
              'seal.mcpApprovals.metaRelay',
              'Came through the Seal relay · expires in {{value0}}s',
              { value0: secondsLeft }
            )
          : t('seal.mcpApprovals.meta', 'Over {{value0}} · expires in {{value1}}s', {
              value0: approval.transport,
              value1: secondsLeft
            })}
      </Text>
      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={() => onAnswer(false)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, busy && styles.dimmed, pressed && pressedStyle]}
        >
          {answering === 'deny' ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : null}
          <Text style={styles.buttonText}>{t('seal.mcpApprovals.deny', 'Deny')}</Text>
        </Pressable>
        <Pressable
          disabled={busy}
          onPress={() => onAnswer(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, busy && styles.dimmed, pressed && pressedStyle]}
        >
          {answering === 'approve' ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : null}
          <Text style={[styles.buttonText, styles.approveText]}>
            {t('seal.mcpApprovals.approve', 'Approve')}
          </Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  card: {
    borderRadius: radii.surface,
    borderWidth: 1,
    borderColor: colors.floatingCardBorder,
    backgroundColor: colors.composerSurface,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  summary: {
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    color: colors.textPrimary
  },
  reason: { fontSize: typography.metaSize, color: colors.textSecondary },
  meta: { fontSize: typography.metaSize, color: colors.textMuted },
  actions: { flexDirection: 'row', gap: spacing.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 44,
    borderRadius: radii.control,
    backgroundColor: colors.composerControl,
    paddingHorizontal: spacing.md
  },
  dimmed: { opacity: 0.4 },
  buttonText: { fontSize: typography.bodySize, fontWeight: '500', color: colors.textPrimary },
  approveText: { color: colors.accentBlue },
  error: { fontSize: typography.metaSize, color: colors.statusRed }
}))
