import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { Hand } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { LiveSession } from './live-session-schemas'

/** The agent's open permission prompt, one button per option it offers. */
export function LivePermissionCard({
  permission,
  answering,
  error,
  onAnswer
}: {
  permission: NonNullable<LiveSession['permission']>
  /** The option id whose answer is in flight. */
  answering: string | null
  error: string | null
  onAnswer: (optionId: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <Hand size={16} color={colors.statusAmber} />
        <Text style={styles.heading}>
          {t('seal.liveSessions.permissionTitle', 'Needs your answer')}
        </Text>
      </View>
      <Text style={styles.question} selectable>
        {permission.question}
      </Text>
      <View style={styles.options}>
        {permission.options.map((option) => (
          <Pressable
            key={option.id}
            disabled={answering !== null}
            onPress={() => onAnswer(option.id)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.option,
              answering !== null && answering !== option.id && styles.dimmed,
              pressed && pressedStyle
            ]}
          >
            {answering === option.id ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : null}
            <Text style={styles.optionText}>{option.label}</Text>
          </Pressable>
        ))}
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
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heading: { fontSize: typography.metaSize, fontWeight: '600', color: colors.textSecondary },
  question: { fontSize: typography.bodySize, color: colors.textPrimary },
  options: { gap: spacing.sm },
  option: {
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
  optionText: { fontSize: typography.bodySize, fontWeight: '500', color: colors.textPrimary },
  error: { fontSize: typography.metaSize, color: colors.statusRed }
}))
