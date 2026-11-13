import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { MobileMarkdown } from '../../components/MobileMarkdown'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { liveMessageStateLabel } from './live-session-presentation'
import type { LiveMessage, LiveTranscriptMessage } from './live-session-schemas'

const textOf = (message: LiveTranscriptMessage) =>
  message.blocks
    .flatMap((block) => (block.type === 'text' && block.text ? [block.text] : []))
    .join('\n\n')
    .trim()

/** One transcript row: the person's words in a bubble, the agent's as prose, tools as one quiet line each. */
export const LiveTranscriptRow = memo(function LiveTranscriptRow({
  message
}: {
  message: LiveTranscriptMessage
}) {
  useMobileColorScheme()
  const text = textOf(message)
  if (message.role === 'user') {
    return text ? (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText} selectable>
            {text}
          </Text>
        </View>
      </View>
    ) : null
  }
  if (message.role === 'reasoning') {
    return text ? (
      <Text style={styles.reasoning} numberOfLines={3}>
        {text}
      </Text>
    ) : null
  }
  if (message.role === 'system') {
    return text ? <Text style={styles.system}>{text}</Text> : null
  }
  // Blocks only ever append, so their position within the message is a stable identity.
  const tools = message.blocks.flatMap((block, position) =>
    block.type === 'tool-call' || (block.type === 'tool-result' && block.isError)
      ? [
          {
            block,
            key: block.callId ? `${block.type}:${block.callId}` : `${message.id}:${position}`
          }
        ]
      : []
  )
  if (!text && tools.length === 0) {
    return null
  }
  return (
    <View style={styles.agentRow}>
      {text ? <MobileMarkdown content={text} /> : null}
      {tools.map(({ block, key }) =>
        block.type === 'tool-call' ? (
          <Text key={key} style={styles.tool} numberOfLines={1}>
            {block.name}
          </Text>
        ) : (
          <Text key={key} style={[styles.tool, styles.toolError]} numberOfLines={2}>
            {block.output}
          </Text>
        )
      )}
    </View>
  )
})

/** A message the phone sent that the transcript doesn't show yet. */
export function LivePendingRow({
  message,
  onRetry
}: {
  message: LiveMessage
  onRetry: ((message: LiveMessage) => void) | null
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const failed = message.state === 'failed'
  return (
    <View style={styles.userRow}>
      <View style={[styles.userBubble, styles.pendingBubble]}>
        <Text style={styles.userText}>{message.text}</Text>
      </View>
      <View style={styles.pendingMeta}>
        <Text style={[styles.pendingState, failed && styles.toolError]} numberOfLines={2}>
          {liveMessageStateLabel(message)}
        </Text>
        {failed && onRetry ? (
          <Pressable
            onPress={() => onRetry(message)}
            hitSlop={8}
            accessibilityRole="button"
            style={({ pressed }) => pressed && pressedStyle}
          >
            <Text style={styles.retry}>{t('common.retry', 'Retry')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  userRow: { alignItems: 'flex-end', marginVertical: spacing.sm },
  userBubble: {
    maxWidth: '85%',
    backgroundColor: colors.chatUserSurface,
    borderColor: colors.chatUserBorder,
    borderWidth: 1,
    borderRadius: radii.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm
  },
  pendingBubble: { opacity: 0.7 },
  userText: { fontSize: typography.bodySize, color: colors.textPrimary },
  pendingMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs
  },
  pendingState: { fontSize: typography.metaSize, color: colors.textMuted, flexShrink: 1 },
  retry: { fontSize: typography.metaSize, fontWeight: '600', color: colors.accentBlue },
  agentRow: { marginVertical: spacing.sm, gap: spacing.xs },
  reasoning: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginVertical: spacing.xs
  },
  system: {
    fontSize: typography.metaSize,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: spacing.sm
  },
  tool: {
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    color: colors.textSecondary
  },
  toolError: { color: colors.statusRed }
}))
