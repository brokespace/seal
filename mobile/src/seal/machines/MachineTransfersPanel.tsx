import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileMachineTransfer } from './machine-reply-schemas'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { formatMachineBytes } from './machine-vitals-format'
import type { MachineFileExportProgress } from './use-machine-file-export'
import type { PhoneUploadItem } from './use-machine-uploads'

type RowProps = {
  title: string
  meta: string
  fraction: number | null
  running: boolean
  failed?: boolean
  action: { label: string; onPress: () => void } | null
}

function TransferRow({ title, meta, fraction, running, failed = false, action }: RowProps) {
  return (
    <View style={styles.transferRow}>
      <View style={styles.transferTitleRow}>
        {running ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
        <Text style={styles.transferTitle} numberOfLines={1}>
          {title}
        </Text>
        {action ? (
          <Pressable
            style={({ pressed }) => [styles.transferAction, pressed && pressedStyle]}
            onPress={action.onPress}
            hitSlop={8}
            accessibilityRole="button"
          >
            <Text style={styles.transferActionText}>{action.label}</Text>
          </Pressable>
        ) : null}
      </View>
      {fraction !== null ? (
        <View style={styles.vitalTrack}>
          <View style={[styles.vitalFill, { width: `${Math.max(2, fraction * 100)}%` }]} />
        </View>
      ) : null}
      <Text style={failed ? styles.inlineError : styles.transferMeta} numberOfLines={2}>
        {meta}
      </Text>
    </View>
  )
}

function progressText(done: number, total: number | null): string {
  return total === null || total <= 0
    ? formatMachineBytes(done)
    : `${formatMachineBytes(done)} / ${formatMachineBytes(total)}`
}

/** Downloads to the phone, uploads from it, and the host's transfers into this machine, newest last. */
export function MachineTransfersPanel({
  exportProgress,
  onCancelExport,
  uploads,
  onCancelUpload,
  transfers,
  onCancelTransfer,
  onClearFinished,
  bottomInset
}: {
  exportProgress: MachineFileExportProgress | null
  onCancelExport: () => void
  uploads: readonly PhoneUploadItem[]
  onCancelUpload: (key: string) => void
  transfers: readonly MobileMachineTransfer[]
  onCancelTransfer: (transferId: string) => void
  onClearFinished: () => void
  bottomInset: number
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  if (!exportProgress && uploads.length === 0 && transfers.length === 0) {
    return null
  }
  const cancel = t('common.cancel', 'Cancel')
  const hasFinished = transfers.some((transfer) => transfer.status !== 'running')
  return (
    <View style={[styles.transfers, { paddingBottom: spacing.sm + bottomInset }]}>
      {exportProgress ? (
        <TransferRow
          title={exportProgress.fileName}
          meta={
            exportProgress.total === null
              ? t('seal.machines.transfers.preparing', 'Preparing download…')
              : t('seal.machines.transfers.toPhone', 'To this phone · {{progress}}', {
                  progress: progressText(exportProgress.received, exportProgress.total)
                })
          }
          fraction={exportProgress.total ? exportProgress.received / exportProgress.total : null}
          running
          action={{ label: cancel, onPress: onCancelExport }}
        />
      ) : null}
      {uploads.map((upload) => (
        <TransferRow
          key={upload.key}
          title={upload.fileName}
          meta={
            upload.status === 'failed'
              ? (upload.error ?? t('seal.machines.upload.failed', 'Upload failed'))
              : upload.status === 'queued'
                ? t('seal.machines.transfers.queued', 'Waiting to upload')
                : t('seal.machines.transfers.fromPhone', 'From this phone · {{progress}}', {
                    progress: progressText(upload.sent, upload.size)
                  })
          }
          fraction={
            upload.status === 'uploading' && upload.size > 0 ? upload.sent / upload.size : null
          }
          running={upload.status === 'uploading'}
          failed={upload.status === 'failed'}
          action={{
            label:
              upload.status === 'failed' ? t('seal.machines.transfers.dismiss', 'Dismiss') : cancel,
            onPress: () => onCancelUpload(upload.key)
          }}
        />
      ))}
      {transfers.map((transfer) => (
        <TransferRow
          key={transfer.id}
          title={transfer.label}
          meta={
            transfer.status === 'failed'
              ? (transfer.error ?? t('seal.machines.transfers.failed', 'Transfer failed'))
              : transfer.status === 'cancelled'
                ? t('seal.machines.transfers.cancelled', 'Cancelled')
                : transfer.status === 'done'
                  ? t('seal.machines.transfers.done', 'Done · {{size}}', {
                      size: formatMachineBytes(transfer.transferredBytes)
                    })
                  : transfer.direction === 'url-download'
                    ? t('seal.machines.transfers.fromUrl', 'From URL · {{progress}}', {
                        progress: progressText(transfer.transferredBytes, transfer.totalBytes)
                      })
                    : t('seal.machines.transfers.toMachine', 'To the machine · {{progress}}', {
                        progress: progressText(transfer.transferredBytes, transfer.totalBytes)
                      })
          }
          fraction={
            transfer.status === 'running' && transfer.totalBytes
              ? transfer.transferredBytes / transfer.totalBytes
              : null
          }
          running={transfer.status === 'running'}
          failed={transfer.status === 'failed'}
          action={
            transfer.status === 'running'
              ? { label: cancel, onPress: () => onCancelTransfer(transfer.id) }
              : null
          }
        />
      ))}
      {hasFinished ? (
        <Pressable
          style={({ pressed }) => [styles.transferAction, pressed && pressedStyle]}
          onPress={onClearFinished}
          accessibilityRole="button"
        >
          <Text style={styles.transferActionText}>
            {t('seal.machines.transfers.clearFinished', 'Clear finished')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
