import { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { ArrowUp, File, Image as ImageIcon, Paperclip, Square, X } from 'lucide-react-native'
import { ActionSheetModal } from '../../components/ActionSheetModal'
import { LoadingSpinner } from '../../components/LoadingSpinner'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { pickFilesForUpload, pickPhotosForUpload } from '../transfers/phone-file-device'
import type { PhoneUploadSource } from '../transfers/phone-upload-source'
import { formatHomeChatBytes } from './home-chat-format'
import { homeChatStyles as styles } from './home-chat-styles'
import type { HomeChatPendingUpload } from './use-home-chat-uploads'

export function HomeChatComposer({
  running,
  disabled,
  uploads,
  onAttach,
  onRemoveUpload,
  onSend,
  onStop,
  onError
}: {
  running: boolean
  /** No connection to the host: nothing can be sent. */
  disabled: boolean
  uploads: readonly HomeChatPendingUpload[]
  onAttach: (sources: PhoneUploadSource[]) => void
  onRemoveUpload: (key: string) => void
  /** Resolves true once the host took the message, so the draft can clear. */
  onSend: (text: string) => Promise<boolean>
  onStop: () => void
  onError: (message: string) => void
}) {
  const t = useMobileTranslation()
  useMobileColorScheme()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [picking, setPicking] = useState(false)
  const uploading = uploads.some((upload) => upload.path === null)
  const hasContent = text.trim().length > 0 || uploads.some((upload) => upload.path !== null)
  const canSend = !disabled && !running && !sending && !uploading && hasContent

  const send = () => {
    if (!canSend) {
      return
    }
    setSending(true)
    void onSend(text)
      .then((sent) => sent && setText(''))
      .finally(() => setSending(false))
  }

  const pick = (picker: () => Promise<PhoneUploadSource[]>) => {
    picker().then(
      (sources) => sources.length > 0 && onAttach(sources),
      (error: unknown) =>
        onError(
          t('seal.homeChat.composer.pickFailed', 'Could not open the picker: {{reason}}', {
            reason: error instanceof Error ? error.message : String(error)
          })
        )
    )
  }

  return (
    <View style={styles.composer}>
      {uploads.length > 0 ? (
        <View style={styles.pendingFiles}>
          {uploads.map((upload) => (
            <View key={upload.key} style={styles.pendingFile}>
              {upload.path === null ? (
                <LoadingSpinner size={12} color={colors.textSecondary} />
              ) : (
                <Paperclip size={12} color={colors.textSecondary} />
              )}
              <Text style={styles.pendingFileText} numberOfLines={1}>
                {upload.path === null && upload.size > 0
                  ? `${upload.name} · ${formatHomeChatBytes(upload.sent)} / ${formatHomeChatBytes(upload.size)}`
                  : upload.name}
              </Text>
              <Pressable
                style={({ pressed }) => [pressed && pressedStyle]}
                hitSlop={8}
                onPress={() => onRemoveUpload(upload.key)}
                accessibilityRole="button"
                accessibilityLabel={t('seal.homeChat.composer.removeFile', 'Remove {{name}}', {
                  name: upload.name
                })}
              >
                <X size={14} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <TextInput
        style={styles.composerInput}
        value={text}
        onChangeText={setText}
        multiline
        placeholder={t(
          'seal.homeChat.composer.placeholder',
          'Ask Seal to do something on any of your machines…'
        )}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accentBlue}
        accessibilityLabel={t('seal.homeChat.composer.message', 'Message')}
        editable={!disabled}
      />
      <View style={styles.composerBar}>
        <Pressable
          style={({ pressed }) => [
            styles.composerButton,
            disabled && styles.disabled,
            pressed && pressedStyle
          ]}
          disabled={disabled}
          onPress={() => setPicking(true)}
          accessibilityRole="button"
          accessibilityLabel={t('seal.homeChat.composer.attach', 'Attach files')}
        >
          <Paperclip size={18} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.flex} />
        {running ? (
          <Pressable
            style={({ pressed }) => [
              styles.composerButton,
              disabled && styles.disabled,
              pressed && pressedStyle
            ]}
            disabled={disabled}
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel={t('seal.homeChat.composer.stop', 'Stop')}
          >
            <Square size={14} color={colors.textPrimary} fill={colors.textPrimary} />
          </Pressable>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.composerButton,
              styles.sendButton,
              !canSend && styles.disabled,
              pressed && pressedStyle
            ]}
            disabled={!canSend}
            onPress={send}
            accessibilityRole="button"
            accessibilityLabel={t('seal.homeChat.composer.send', 'Send')}
          >
            {sending ? (
              <LoadingSpinner size={16} color={colors.bgBase} />
            ) : (
              <ArrowUp size={18} color={colors.bgBase} />
            )}
          </Pressable>
        )}
      </View>
      <ActionSheetModal
        visible={picking}
        title={t('seal.homeChat.composer.attach', 'Attach files')}
        onClose={() => setPicking(false)}
        actions={[
          {
            label: t('seal.homeChat.composer.photos', 'Photos'),
            icon: ImageIcon,
            closeBeforePress: true,
            onPress: () => pick(pickPhotosForUpload)
          },
          {
            label: t('seal.homeChat.composer.files', 'Files'),
            icon: File,
            closeBeforePress: true,
            onPress: () => pick(pickFilesForUpload)
          }
        ]}
      />
    </View>
  )
}
