import { useLayoutEffect } from 'react'
import { Pressable, Text, View } from 'react-native'
import { CircleAlert } from 'lucide-react-native'
import { LIST_ROW_PADDING } from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useMobileNativeChatLowerRegion } from '../../session/native-chat/mobile-native-chat-lower-region-context'
import { colors, pressedStyle, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { LiveMessage } from './live-session-schemas'

/** Messages the session did not get, in the chat's tray above the composer; each can be sent again. */
export function LiveSessionUndeliveredSends({
  messages,
  onRetry
}: {
  messages: readonly LiveMessage[]
  /** Null while the host is out of reach. */
  onRetry: ((message: LiveMessage) => void) | null
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const lowerRegion = useMobileNativeChatLowerRegion()
  // The chat sizes its list by the tray's height, which it does not watch.
  useLayoutEffect(() => lowerRegion?.layoutChanged())
  if (messages.length === 0) {
    return null
  }
  return (
    <View style={styles.list} testID="live-session-undelivered">
      {messages.map((message) => (
        <View key={message.messageId} style={styles.row}>
          <CircleAlert size={14} color={colors.statusRed} strokeWidth={2.2} />
          <View style={styles.main}>
            <Text style={styles.text} numberOfLines={2}>
              {message.text}
            </Text>
            <Text style={styles.error} numberOfLines={2}>
              {message.error ?? t('seal.liveSessions.message.failed', 'Not delivered')}
            </Text>
          </View>
          {onRetry ? (
            <Pressable
              onPress={() => onRetry(message)}
              hitSlop={spacing.sm}
              accessibilityRole="button"
              testID={`live-session-retry-${message.messageId}`}
              style={({ pressed }) => [styles.retry, pressed && pressedStyle]}
            >
              <Text style={styles.retryLabel}>{t('common.retry', 'Retry')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.surface,
    backgroundColor: colors.sheetGroup,
    paddingHorizontal: LIST_ROW_PADDING,
    paddingVertical: spacing.sm
  },
  main: { flex: 1, minWidth: 0, gap: 2 },
  text: { fontSize: typography.bodySize, color: colors.textPrimary },
  error: { fontSize: typography.metaSize, color: colors.statusRed },
  retry: {
    borderRadius: radii.pill,
    backgroundColor: colors.translucentFill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs
  },
  retryLabel: { fontSize: typography.metaSize, fontWeight: '600', color: colors.textPrimary }
}))
