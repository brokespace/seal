import { useCallback, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View
} from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ChevronLeft,
  ChevronRight,
  FolderOpen,
  FolderPlus,
  Images,
  Link,
  Plus,
  Upload
} from 'lucide-react-native'
import { joinMachinePath, machinePathCrumbs } from '../../../../src/shared/machines/machine-paths'
import { ActionSheetModal } from '../../components/ActionSheetModal'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { TransientToast, useTransientToast } from '../../components/TransientToast'
import { HOST_LIST_TARGET, NO_HOST_LIST_INPUT } from '../../host-screen/catalog/host-list-queries'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { ImageLibraryPermissionError } from '../../platform/media-picking/media-picker-contract'
import { useHostQuery } from '../../query/host-query'
import { hostScreenState } from '../../query/host-query-screen-state'
import { useRefreshHint } from '../../query/refresh-hint'
import { connectionRetryAction } from '../../transport/connection/connection-retry-action'
import { useForceReconnect, useHostClient } from '../../transport/connection/host-client-hooks'
import { colors, pressedStyle, spacing } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { pickFilesForUpload, pickPhotosForUpload } from '../transfers/phone-file-device'
import {
  machineDirectoryHasMore,
  machineMetricsQuery,
  machineQueryTarget,
  machinesListQuery,
  startMachineUrlDownload
} from './machine-operations'
import type { MobileMachineFileEntry } from './machine-reply-schemas'
import { machineDetailHref, machineFilePreviewHref } from './machine-routes'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { MachineFileRow } from './MachineFileRow'
import { MachineTransfersPanel } from './MachineTransfersPanel'
import { MachineUrlDownloadSheet } from './MachineUrlDownloadSheet'
import { MachineVitalsBars } from './MachineVitalsBars'
import { useMachineDirectory } from './use-machine-directory'
import { useMachineEntryActions } from './use-machine-entry-actions'
import { useMachineFileExport } from './use-machine-file-export'
import { useMachineTransfers } from './use-machine-transfers'
import { useMachineUploads } from './use-machine-uploads'

const NO_INPUT = {}

function MachinePathCrumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  const crumbs = useMemo(() => machinePathCrumbs(path), [path])
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.crumbs}
      contentContainerStyle={styles.crumbsContent}
    >
      {crumbs.map((crumb, index) => {
        const last = index === crumbs.length - 1
        return (
          <View key={crumb.path} style={styles.vitalRow}>
            {index > 0 ? <ChevronRight size={12} color={colors.textMuted} /> : null}
            <Pressable
              style={({ pressed }) => [styles.crumb, pressed && pressedStyle]}
              onPress={() => onOpen(crumb.path)}
              disabled={last}
              accessibilityRole="link"
            >
              <Text style={[styles.crumbText, last && styles.crumbCurrent]} numberOfLines={1}>
                {crumb.label}
              </Text>
            </Pressable>
          </View>
        )
      })}
    </ScrollView>
  )
}

export function MachineDetailScreen({
  hostId,
  machineId,
  path
}: {
  hostId: string
  machineId: string
  path: string
}) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const forceReconnect = useForceReconnect()
  const { client, state: connState } = useHostClient(hostId)
  const host = { hostId, client }
  const { message, showToast } = useTransientToast()
  const machines = useHostQuery(machinesListQuery, host, HOST_LIST_TARGET, NO_HOST_LIST_INPUT)
  const machine = machines.data?.find((candidate) => candidate.id === machineId)
  const metrics = useHostQuery(machineMetricsQuery, host, machineQueryTarget(machineId), NO_INPUT)
  const directory = useMachineDirectory({ hostId, client, machineId, path })
  const { listing, refresh } = directory
  const folder = listing.data?.path ?? path
  const [pulling, setPulling] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [urlSheetOpen, setUrlSheetOpen] = useState(false)
  const refreshing = useRefreshHint(directory.revalidating && !pulling)

  const transfers = useMachineTransfers({
    hostId,
    client,
    machineId,
    onFinished: (transfer) => {
      if (transfer.status === 'done') {
        void refresh()
      }
    }
  })
  const uploads = useMachineUploads({ client, machineId, onCommitted: transfers.track })
  const fileExport = useMachineFileExport({
    client,
    machineId,
    onError: showToast,
    onSaved: showToast
  })
  const entryActions = useMachineEntryActions({
    client,
    machineId,
    folder,
    onChanged: () => void refresh(),
    onExport: (target, intent) => void fileExport.exportFile(target, intent),
    showMessage: showToast
  })

  const openEntry = useCallback(
    (entry: MobileMachineFileEntry) => {
      const target = joinMachinePath(folder, entry.name)
      router.push(
        entry.isDirectoryLike
          ? machineDetailHref(hostId, machineId, target)
          : machineFilePreviewHref(hostId, machineId, target, entry.size)
      )
    },
    [folder, hostId, machineId, router]
  )
  const { openEntryActions } = entryActions
  const longPressEntry = useCallback(
    (entry: MobileMachineFileEntry) => openEntryActions(joinMachinePath(folder, entry.name), entry),
    [folder, openEntryActions]
  )
  const openCrumb = useCallback(
    (target: string) => router.dismissTo(machineDetailHref(hostId, machineId, target)),
    [hostId, machineId, router]
  )

  const pickAndUpload = async (source: 'photos' | 'files') => {
    try {
      const picked = source === 'photos' ? await pickPhotosForUpload() : await pickFilesForUpload()
      uploads.enqueue(picked, folder)
    } catch (error) {
      showToast(
        error instanceof ImageLibraryPermissionError
          ? t(
              'seal.machines.upload.photosDenied',
              'Allow photo access in Settings to upload photos'
            )
          : error instanceof Error && error.message
            ? error.message
            : t('seal.machines.upload.failed', 'Upload failed')
      )
    }
  }

  const pullToRefresh = async () => {
    setPulling(true)
    try {
      await Promise.all([refresh(), metrics.refetch()])
    } finally {
      setPulling(false)
    }
  }

  const screen = hostScreenState(
    { data: listing.data, error: listing.error, isFetching: listing.isFetching },
    connState
  )
  const retry = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => void listing.refetch()
  })
  const busyPanel =
    fileExport.progress !== null || uploads.uploads.length > 0 || transfers.transfers.length > 0

  const header = (
    <View style={styles.detailHeader}>
      {machine?.status !== 'offline' ? (
        <MachineVitalsBars metrics={metrics.data} loading={metrics.isFetching} />
      ) : null}
      <MachinePathCrumbs path={folder} onOpen={openCrumb} />
    </View>
  )

  const footer = listing.data ? (
    <View style={styles.footerStatus}>
      {directory.loadingMore ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : directory.pageError ? (
        <Text style={styles.inlineError}>{directory.pageError}</Text>
      ) : machineDirectoryHasMore(listing.data) ? (
        <Text style={styles.footerText}>
          {t('seal.machines.browser.showingCount', '{{shown}} of {{total}}', {
            shown: listing.data.entries.length,
            total: listing.data.totalEntries
          })}
        </Text>
      ) : null}
    </View>
  ) : null

  const body =
    screen === 'empty-offline' ? (
      <MobileOfflineState onReconnect={retry} />
    ) : screen === 'empty-error' ? (
      <MobileLoadErrorState
        error={listing.error ?? t('seal.machines.browser.loadFailed', 'Unable to load this folder')}
        onRetry={retry}
      />
    ) : screen !== 'data' ? (
      <MobileStateView loading title={t('seal.machines.browser.loading', 'Loading folder…')} />
    ) : (
      <FlatList
        data={listing.data?.entries}
        keyExtractor={(entry) => entry.name}
        renderItem={({ item }) => (
          <MachineFileRow entry={item} onOpen={openEntry} onLongPress={longPressEntry} />
        )}
        ListHeaderComponent={header}
        ListFooterComponent={footer ?? undefined}
        ListEmptyComponent={
          <MobileStateView
            icon={FolderOpen}
            title={t('seal.machines.browser.empty', 'This folder is empty')}
          />
        }
        onEndReached={() => void directory.loadMore()}
        onEndReachedThreshold={1.5}
        initialNumToRender={30}
        maxToRenderPerBatch={40}
        windowSize={11}
        contentContainerStyle={{ paddingBottom: busyPanel ? spacing.sm : insets.bottom }}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void pullToRefresh()}
            tintColor={colors.textMuted}
          />
        }
      />
    )

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.header} edges={['top']}>
        <NavBar
          leading={
            <NavBarButton
              icon={ChevronLeft}
              onPress={() => router.back()}
              accessibilityLabel={t('common.back', 'Back')}
            />
          }
          title={machine?.label ?? t('seal.machines.detail.title', 'Machine')}
          subtitle={machine?.address ?? undefined}
          refreshing={refreshing}
          trailing={
            <NavBarButton
              icon={Plus}
              onPress={() => setMenuOpen(true)}
              disabled={screen !== 'data'}
              accessibilityLabel={t('seal.machines.browser.addMenu', 'Add to this folder')}
            />
          }
        />
      </SafeAreaView>
      {body}
      <MachineTransfersPanel
        exportProgress={fileExport.progress}
        onCancelExport={fileExport.cancel}
        uploads={uploads.uploads}
        onCancelUpload={uploads.cancel}
        transfers={transfers.transfers}
        onCancelTransfer={(transferId) =>
          void transfers
            .cancel(transferId)
            .catch((error: unknown) =>
              showToast(
                error instanceof Error && error.message
                  ? error.message
                  : t('seal.machines.transfers.cancelFailed', 'Unable to cancel')
              )
            )
        }
        onClearFinished={transfers.clearFinished}
        bottomInset={insets.bottom}
      />
      <ActionSheetModal
        visible={menuOpen}
        title={folder}
        onClose={() => setMenuOpen(false)}
        actions={[
          {
            id: 'photos',
            label: t('seal.machines.browser.uploadPhotos', 'Upload from Photos'),
            icon: Images,
            closeBeforePress: true,
            onPress: () => void pickAndUpload('photos')
          },
          {
            id: 'files',
            label: t('seal.machines.browser.uploadFiles', 'Upload from Files'),
            icon: Upload,
            closeBeforePress: true,
            onPress: () => void pickAndUpload('files')
          },
          {
            id: 'url',
            label: t('seal.machines.browser.downloadUrl', 'Download from URL'),
            icon: Link,
            closeBeforePress: true,
            onPress: () => setUrlSheetOpen(true)
          },
          {
            id: 'folder',
            label: t('seal.machines.browser.newFolder', 'New Folder'),
            icon: FolderPlus,
            closeBeforePress: true,
            onPress: entryActions.openNewFolder
          }
        ]}
      />
      <MachineUrlDownloadSheet
        visible={urlSheetOpen}
        folder={folder}
        onClose={() => setUrlSheetOpen(false)}
        onSubmit={async (request) => {
          if (!client) {
            throw new Error(t('seal.machines.offline', 'Waiting for the desktop connection'))
          }
          transfers.track(
            await startMachineUrlDownload(client, { machineId, destDir: folder, ...request })
          )
        }}
      />
      {entryActions.sheets}
      <TransientToast message={message} bottomInset={insets.bottom} />
    </View>
  )
}
