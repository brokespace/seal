import { Text, View } from 'react-native'
import { ListChecks, MessageCircleQuestionMark } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

/** How many questions and action items still wait on the user, on a row or the recap banner. Nothing at zero. */
export function SessionRecapCounts({ questions, actions }: { questions: number; actions: number }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  if (questions + actions === 0) {
    return null
  }
  const label = [
    questions > 0
      ? t('seal.sessionRecap.badgeQuestions', 'Questions for you: {{count}}', { count: questions })
      : null,
    actions > 0
      ? t('seal.sessionRecap.badgeActions', 'Your action items: {{count}}', { count: actions })
      : null
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <View style={styles.counts} accessible accessibilityLabel={label} testID="session-recap-counts">
      {questions > 0 ? (
        <View style={styles.count}>
          <MessageCircleQuestionMark size={13} color={colors.statusAmber} strokeWidth={2.2} />
          <Text style={styles.number}>{questions}</Text>
        </View>
      ) : null}
      {actions > 0 ? (
        <View style={styles.count}>
          <ListChecks size={13} color={colors.statusAmber} strokeWidth={2.2} />
          <Text style={styles.number}>{actions}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  counts: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  number: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.statusAmber,
    fontVariant: ['tabular-nums']
  }
}))
