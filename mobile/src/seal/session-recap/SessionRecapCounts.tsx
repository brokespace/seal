import { Text, View } from 'react-native'
import { ListChecks, ListX, MessageCircleQuestionMark } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { LiveSessionRecapBrief } from '../../../../src/shared/session-recap/session-recap-types'
import { recapAttention } from '../../../../src/shared/session-recap/session-recap-view'

/** The questions, action items and unaddressed requests that wait on the user, on a session's row. Nothing at zero. */
export function SessionRecapCounts({ brief }: { brief: LiveSessionRecapBrief | undefined }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const { questions, actions, notAddressed, total } = recapAttention(brief)
  if (total === 0) {
    return null
  }
  const label = [
    questions > 0
      ? t('seal.sessionRecap.badgeQuestions', 'Questions for you: {{count}}', { count: questions })
      : null,
    actions > 0
      ? t('seal.sessionRecap.badgeActions', 'Your action items: {{count}}', { count: actions })
      : null,
    notAddressed > 0
      ? t('seal.sessionRecap.badgeNotAddressed', 'Requests not addressed: {{count}}', {
          count: notAddressed
        })
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
      {notAddressed > 0 ? (
        <View style={styles.count}>
          <ListX size={13} color={colors.statusAmber} strokeWidth={2.2} />
          <Text style={styles.number}>{notAddressed}</Text>
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
