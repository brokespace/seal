import { Pressable, Text } from 'react-native'
import { ChevronRight, NotebookText } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { SessionRecapView } from '../../../../src/shared/session-recap/session-recap-types'
import {
  recapHeadline,
  recapItemsByMark
} from '../../../../src/shared/session-recap/session-recap-view'
import { sealStyles } from '../seal-screen-styles'
import { SessionRecapCounts } from './SessionRecapCounts'

/**
 * The recap folded to a line above a session's transcript: where things stand and what waits on
 * the user. Pressing it opens the whole recap.
 */
export function SessionRecapBanner({
  view,
  onOpen
}: {
  view: SessionRecapView | null
  onOpen: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const recap = view?.recap ?? null
  const headline = recapHeadline(recap)
  const writing = view?.state === 'updating'
  if (view === null || (headline === null && !writing)) {
    return null
  }
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('seal.sessionRecap.open', 'Open recap')}
      testID="session-recap-banner"
      style={({ pressed }) => [sealStyles.banner, styles.banner, pressed && pressedStyle]}
    >
      <NotebookText size={16} color={colors.textSecondary} strokeWidth={2} />
      <Text style={headline ? styles.headline : styles.writing} numberOfLines={2}>
        {headline ?? t('seal.sessionRecap.writing', 'Reading the session\u2026')}
      </Text>
      {recap ? (
        <SessionRecapCounts
          questions={recapItemsByMark(recap.questions, view.marks).open.length}
          actions={recapItemsByMark(recap.actions, view.marks).open.length}
        />
      ) : null}
      <ChevronRight size={15} color={colors.textMuted} strokeWidth={2.2} />
    </Pressable>
  )
}

const styles = themedStyleSheet(() => ({
  banner: { marginHorizontal: spacing.lg, marginTop: spacing.sm, marginBottom: 0 },
  headline: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textPrimary },
  writing: { flex: 1, fontSize: typography.bodySize, color: colors.textMuted }
}))
