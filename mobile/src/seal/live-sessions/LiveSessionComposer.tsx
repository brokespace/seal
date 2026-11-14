import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { ArrowUp } from 'lucide-react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, radii, spacing, typography } from '../../theme/mobile-theme'
import { themedStyleSheet } from '../../theme/themed-styles'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'

/** Text box and Send; `hint` replaces the box when Seal can't type into the session. */
export function LiveSessionComposer({
  hint,
  disabled,
  onSend
}: {
  hint: string | null
  disabled: boolean
  /** The sent text stays visible as a pending bubble, so the box clears at once. */
  onSend: (text: string) => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [draft, setDraft] = useState('')
  if (hint) {
    return (
      <View style={styles.bar}>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    )
  }
  const text = draft.trim()
  const canSend = text.length > 0 && !disabled
  const send = () => {
    if (canSend) {
      onSend(text)
      setDraft('')
    }
  }
  return (
    <View style={styles.bar}>
      <View style={styles.box}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder={t('seal.liveSessions.composerPlaceholder', 'Message this session')}
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!disabled}
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel={t('seal.liveSessions.send', 'Send')}
          accessibilityState={{ disabled: !canSend }}
          hitSlop={6}
          style={[styles.send, !canSend && styles.sendDisabled]}
        >
          <ArrowUp size={18} color={colors.onAccent} />
        </Pressable>
      </View>
    </View>
  )
}

const styles = themedStyleSheet(() => ({
  bar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bgBase
  },
  box: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    borderRadius: radii.floating,
    borderWidth: 1,
    borderColor: colors.composerBorder,
    backgroundColor: colors.composerSurface,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs + 2,
    paddingVertical: spacing.xs + 2
  },
  input: {
    flex: 1,
    maxHeight: 140,
    minHeight: 36,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    fontSize: typography.bodySize + 2,
    color: colors.textPrimary
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBlue
  },
  sendDisabled: { opacity: 0.4 },
  hint: { fontSize: typography.metaSize, color: colors.textMuted, textAlign: 'center' }
}))
