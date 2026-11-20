import { useEffect, useMemo, useState } from 'react'
import { Image, ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { Buffer } from 'buffer/index.js'
import { ChevronLeft, File, Share2 } from 'lucide-react-native'
import { machinePathBasename } from '../../../../src/shared/machines/machine-paths'
import { PHONE_MACHINE_PREVIEW_MAX_BYTES } from '../../../../src/shared/rpc-contract/seal-machines-params'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { TransientToast, useTransientToast } from '../../components/TransientToast'
import { isMarkdownPath } from '../../files/explorer/file-tree'
import { MobileFileMarkdownPreview } from '../../files/markdown/MobileFileMarkdownPreview'
import {
  MobileMarkdownPreviewModeBar,
  useMarkdownPreviewMode
} from '../../files/markdown/MobileMarkdownPreviewModeBar'
import { mobileFileMediaMime, PDF_MIME_TYPE } from '../../files/media/mobile-file-media'
import { classifyMobileArtifact } from '../../files/preview/mobile-artifact-kind'
import { MobileFilePreviewSourceText } from '../../files/preview/MobileFilePreviewSourceText'
import { filePreviewStyles } from '../../files/preview/mobile-file-preview-styles'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useHostQuery } from '../../query/host-query'
import { hostScreenState } from '../../query/host-query-screen-state'
import { connectionRetryAction } from '../../transport/connection/connection-retry-action'
import { useForceReconnect, useHostClient } from '../../transport/connection/host-client-hooks'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { machineFilePreviewQuery, machineQueryTarget } from './machine-operations'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { MachineTransfersPanel } from './MachineTransfersPanel'
import { formatMachineBytes } from './machine-vitals-format'
import { useMachineFileExport } from './use-machine-file-export'

type PreviewKind = 'image' | 'pdf' | 'markdown' | 'text' | 'other'

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon'
}
const BINARY_PROBE_BYTES = 8192

function previewKindOf(name: string): PreviewKind {
  if (classifyMobileArtifact(name) === 'image') {
    return 'image'
  }
  const media = mobileFileMediaMime(name)
  if (media === PDF_MIME_TYPE) {
    return 'pdf'
  }
  if (media) {
    return 'other'
  }
  return isMarkdownPath(name) ? 'markdown' : 'text'
}

function imageMimeOf(name: string): string {
  return IMAGE_MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png'
}

// Pinch zoom on iOS through ScrollView; Android shows the fitted image.
function ZoomableImage({ uri, label }: { uri: string; label: string }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  return (
    <ScrollView
      style={styles.previewImageScroll}
      contentContainerStyle={styles.previewImageContent}
      maximumZoomScale={5}
      minimumZoomScale={1}
      centerContent
      onLayout={({ nativeEvent }) =>
        setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })
      }
    >
      {size ? (
        <Image
          source={{ uri }}
          style={size}
          resizeMode="contain"
          accessibilityLabel={label}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </ScrollView>
  )
}

function DownloadedImage({
  path,
  label,
  download
}: {
  path: string
  label: string
  download: (path: string) => Promise<{ uri: string } | null>
}) {
  const t = useMobileTranslation()
  const [uri, setUri] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setFailed(false)
    void download(path).then((file) => {
      if (live) {
        setUri(file?.uri ?? null)
        setFailed(file === null)
      }
    })
    return () => {
      live = false
    }
  }, [attempt, download, path])
  if (uri) {
    return <ZoomableImage uri={uri} label={label} />
  }
  return failed ? (
    <MobileLoadErrorState
      error={t('seal.machines.preview.imageFailed', 'Unable to load this image')}
      onRetry={() => setAttempt(attempt + 1)}
    />
  ) : (
    <MobileStateView loading title={t('seal.machines.preview.downloading', 'Downloading…')} />
  )
}

export function MachineFilePreviewScreen({
  hostId,
  machineId,
  path,
  size
}: {
  hostId: string
  machineId: string
  path: string
  size: number | null
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const forceReconnect = useForceReconnect()
  const { client, state: connState } = useHostClient(hostId)
  const { message, showToast } = useTransientToast()
  const name = machinePathBasename(path)
  const kind = previewKindOf(name)
  const oversized = size !== null && size > PHONE_MACHINE_PREVIEW_MAX_BYTES
  // Text opens truncated past the cap; an image or PDF that large comes over as a download instead.
  const readsInline = kind === 'text' || kind === 'markdown' || (kind === 'image' && !oversized)
  const fileExport = useMachineFileExport({
    client,
    machineId,
    onError: showToast,
    onSaved: showToast
  })
  const preview = useHostQuery(
    machineFilePreviewQuery,
    { hostId, client },
    machineQueryTarget(machineId),
    { path },
    { enabled: readsInline }
  )
  const [markdownMode, setMarkdownMode] = useMarkdownPreviewMode(path, undefined)

  const decoded = useMemo(() => {
    if (!preview.data || kind === 'image') {
      return null
    }
    const bytes = Buffer.from(preview.data.contentBase64, 'base64')
    const binary = bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)
    return binary ? null : bytes.toString('utf8')
  }, [kind, preview.data])

  const share = () => void fileExport.exportFile(path, 'share')
  const fileInfo = (
    <MobileStateView
      icon={File}
      title={name}
      message={size !== null ? formatMachineBytes(size) : null}
      action={{ label: t('seal.machines.actions.share', 'Share…'), onPress: share }}
    />
  )

  const screen = hostScreenState(
    { data: preview.data, error: preview.error, isFetching: preview.isFetching },
    connState
  )
  const retry = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => void preview.refetch()
  })

  const body = (() => {
    if (kind === 'pdf') {
      return (
        <MobileStateView
          icon={File}
          title={name}
          message={size !== null ? formatMachineBytes(size) : null}
          action={{
            label: t('seal.machines.preview.openPdf', 'Open PDF'),
            onPress: () => void fileExport.exportFile(path, 'pdf')
          }}
        />
      )
    }
    if (kind === 'other') {
      return fileInfo
    }
    if (kind === 'image' && oversized) {
      return <DownloadedImage path={path} label={name} download={fileExport.download} />
    }
    if (screen === 'empty-offline') {
      return <MobileOfflineState onReconnect={retry} />
    }
    if (screen === 'empty-error') {
      return (
        <MobileLoadErrorState
          error={preview.error ?? t('seal.machines.preview.loadFailed', 'Unable to load this file')}
          onRetry={retry}
        />
      )
    }
    if (!preview.data) {
      return <MobileStateView loading title={t('seal.machines.preview.loading', 'Loading file…')} />
    }
    if (kind === 'image') {
      return (
        <ZoomableImage
          uri={`data:${imageMimeOf(name)};base64,${preview.data.contentBase64}`}
          label={name}
        />
      )
    }
    if (decoded === null) {
      return fileInfo
    }
    if (kind === 'markdown') {
      return (
        <>
          <MobileMarkdownPreviewModeBar
            mode={markdownMode}
            onModeChange={setMarkdownMode}
            relativePath={name}
            content={decoded}
            truncated={preview.data.truncated}
          />
          <MobileFileMarkdownPreview
            mode={markdownMode}
            relativePath={name}
            content={decoded}
            truncated={preview.data.truncated}
            byteLength={preview.data.size}
          />
        </>
      )
    }
    return (
      <MobileFilePreviewSourceText
        relativePath={name}
        content={decoded}
        truncated={preview.data.truncated}
        byteLength={preview.data.size}
      />
    )
  })()

  return (
    <View style={filePreviewStyles.container}>
      <SafeAreaView style={filePreviewStyles.header} edges={['top']}>
        <NavBar
          leading={
            <NavBarButton
              icon={ChevronLeft}
              onPress={() => router.back()}
              accessibilityLabel={t('common.back', 'Back')}
            />
          }
          title={name}
          subtitle={size !== null ? formatMachineBytes(size) : undefined}
          trailing={
            <NavBarButton
              icon={Share2}
              onPress={share}
              disabled={fileExport.progress !== null}
              accessibilityLabel={t('seal.machines.actions.share', 'Share…')}
            />
          }
        />
      </SafeAreaView>
      {body}
      <MachineTransfersPanel
        exportProgress={fileExport.progress}
        onCancelExport={fileExport.cancel}
        uploads={[]}
        onCancelUpload={() => undefined}
        transfers={[]}
        onCancelTransfer={() => undefined}
        onClearFinished={() => undefined}
        bottomInset={insets.bottom}
      />
      <TransientToast message={message} bottomInset={insets.bottom} />
    </View>
  )
}
