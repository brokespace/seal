import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BottomDrawer } from '../../components/bottom-drawer/BottomDrawer'
import { TextField } from '../../components/composer-input/TextField'
import { SheetPrimaryButton } from '../../components/SheetPrimaryButton'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { isValidMachineFileName } from '../../../../src/shared/machines/machine-paths'
import { machineScreenStyles as styles } from './machine-screen-styles'

function isDownloadableUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** URL and optional file name for a download the machine fetches itself into `folder`. */
export function MachineUrlDownloadSheet({
  visible,
  folder,
  onSubmit,
  onClose
}: {
  visible: boolean
  folder: string
  onSubmit: (request: { url: string; fileName?: string }) => Promise<void>
  onClose: () => void
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const [url, setUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedUrl = url.trim()
  const trimmedName = fileName.trim()
  const nameValid = trimmedName === '' || isValidMachineFileName(trimmedName)
  const canSubmit = !busy && isDownloadableUrl(trimmedUrl) && nameValid

  const close = () => {
    setUrl('')
    setFileName('')
    setError(null)
    onClose()
  }

  const submit = async () => {
    if (!canSubmit) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ url: trimmedUrl, ...(trimmedName ? { fileName: trimmedName } : {}) })
      close()
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : t('seal.machines.urlDownload.failed', 'Unable to start the download')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomDrawer visible={visible} onClose={close}>
      <View style={styles.sheetFields}>
        <Text style={styles.sheetTitle}>
          {t('seal.machines.urlDownload.title', 'Download from URL')}
        </Text>
        <Text style={[styles.sheetMessage, styles.mono]} numberOfLines={2}>
          {folder}
        </Text>
        <TextField
          value={url}
          onChangeText={setUrl}
          placeholder={t(
            'seal.machines.urlDownload.urlPlaceholder',
            'https://example.com/file.zip'
          )}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="next"
        />
        <TextField
          value={fileName}
          onChangeText={setFileName}
          placeholder={t('seal.machines.urlDownload.namePlaceholder', 'File name (optional)')}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />
        {error ? (
          <Text style={styles.sheetError}>{error}</Text>
        ) : !nameValid ? (
          <Text style={styles.sheetError}>
            {t('seal.machines.invalidName', 'Names cannot contain / or \\')}
          </Text>
        ) : null}
        <SheetPrimaryButton
          label={t('seal.machines.urlDownload.submit', 'Download')}
          onPress={() => void submit()}
          disabled={!canSubmit}
          busy={busy}
        />
        <Pressable
          style={({ pressed }) => [styles.sheetCancel, pressed && pressedStyle]}
          onPress={close}
          accessibilityRole="button"
        >
          <Text style={styles.transferActionText}>{t('common.cancel', 'Cancel')}</Text>
        </Pressable>
      </View>
    </BottomDrawer>
  )
}
