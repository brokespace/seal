import { memo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { File, FileCode, FileImage, FileText, Folder } from 'lucide-react-native'
import { isMarkdownPath } from '../../files/explorer/file-tree'
import { classifyMobileArtifact } from '../../files/preview/mobile-artifact-kind'
import { getUiIntlLocale } from '../../i18n/ui-intl-locale'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileMachineFileEntry } from './machine-reply-schemas'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { formatMachineBytes } from './machine-vitals-format'

const CODE_EXTENSION =
  /\.(c|cc|cpp|cs|css|go|h|hpp|java|js|jsx|json|kt|lua|php|py|rb|rs|sh|sql|swift|toml|ts|tsx|xml|ya?ml|zsh)$/i

function iconFor(entry: MobileMachineFileEntry) {
  if (entry.isDirectoryLike) {
    return Folder
  }
  const kind = classifyMobileArtifact(entry.name)
  if (kind === 'image' || kind === 'vector') {
    return FileImage
  }
  if (isMarkdownPath(entry.name) || /\.(txt|log|csv)$/i.test(entry.name)) {
    return FileText
  }
  return CODE_EXTENSION.test(entry.name) ? FileCode : File
}

const modifiedFormats = new Map<string, Intl.DateTimeFormat>()

function formatModified(mtimeMs: number): string | null {
  if (!mtimeMs) {
    return null
  }
  const locale = getUiIntlLocale()
  let format = modifiedFormats.get(locale)
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })
    modifiedFormats.set(locale, format)
  }
  return format.format(new Date(mtimeMs))
}

export const MachineFileRow = memo(function MachineFileRow({
  entry,
  onOpen,
  onLongPress
}: {
  entry: MobileMachineFileEntry
  onOpen: (entry: MobileMachineFileEntry) => void
  onLongPress: (entry: MobileMachineFileEntry) => void
}) {
  useMobileColorScheme()
  const Icon = iconFor(entry)
  const modified = formatModified(entry.mtimeMs)
  const meta = entry.isDirectoryLike
    ? modified
    : [formatMachineBytes(entry.size), modified].filter(Boolean).join(' · ')
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={() => onOpen(entry)}
      onLongPress={() => onLongPress(entry)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={entry.name}
    >
      <Icon
        size={20}
        color={entry.isDirectoryLike ? colors.textSecondary : colors.textMuted}
        strokeWidth={1.75}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1} ellipsizeMode="middle">
          {entry.name}
        </Text>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
})
