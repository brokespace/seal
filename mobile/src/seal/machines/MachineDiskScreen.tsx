import { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, File, Folder, FolderOpen, Link2 } from 'lucide-react-native'
import { diskMountOfPath } from '../../../../src/shared/machines/machine-disk-mount-rules'
import {
  machinePathBasename,
  machinePathDirname
} from '../../../../src/shared/machines/machine-paths'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { MobileSegmentedControl } from '../../components/MobileSegmentedControl'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { HOST_LIST_TARGET, NO_HOST_LIST_INPUT } from '../../host-screen/catalog/host-list-queries'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useHostQuery } from '../../query/host-query'
import { hostScreenState } from '../../query/host-query-screen-state'
import { connectionRetryAction } from '../../transport/connection/connection-retry-action'
import { useForceReconnect, useHostClient } from '../../transport/connection/host-client-hooks'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import {
  machineDiskLargestQuery,
  machineDiskListingQuery,
  machineDiskStatusQuery
} from './machine-disk-index-operations'
import { MachineDiskMounts } from './MachineDiskMounts'
import { machineMetricsQuery, machineQueryTarget, machinesListQuery } from './machine-operations'
import { machineDetailHref } from './machine-routes'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { MachinePathCrumbs } from './MachinePathCrumbs'
import { formatMachineBytes, formatMachineUptime } from './machine-vitals-format'

const NO_INPUT = {}
/** Often enough that scan progress reads as live. */
const SCANNING_REFRESH_MS = 2_500
const IDLE_REFRESH_MS = 15_000

type DiskView = 'folders' | 'files' | 'largest-folders'

type DiskRow = {
  path: string
  name: string
  detail: string | null
  kind: 'directory' | 'file' | 'symlink'
  size: string
  /** The folder a tap opens; null for a row that opens nothing. */
  opens: string | null
}

const ROW_ICON = { directory: Folder, file: File, symlink: Link2 }

/** What is taking space on a machine, from the index it keeps of its own disks. */
export function MachineDiskScreen({
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
  const target = machineQueryTarget(machineId)
  const [view, setView] = useState<DiskView>('folders')
  const machines = useHostQuery(machinesListQuery, host, HOST_LIST_TARGET, NO_HOST_LIST_INPUT)
  const machine = machines.data?.find((candidate) => candidate.id === machineId)
  const metrics = useHostQuery(machineMetricsQuery, host, target, NO_INPUT, { enabled: !path })
  const [scanning, setScanning] = useState(true)
  const status = useHostQuery(machineDiskStatusQuery, host, target, NO_INPUT, {
    refetchInterval: scanning ? SCANNING_REFRESH_MS : IDLE_REFRESH_MS
  })
  const disks = status.data
  const nowScanning =
    disks === undefined ||
    disks.scan !== null ||
    disks.mounts.some((mount) => mount.indexed && mount.scannedAt === null)
  useEffect(() => setScanning(nowScanning), [nowScanning])

  const folder = path || metrics.data?.homeDir || ''
  const mount = diskMountOfPath(disks?.mounts ?? [], folder || null)
  const listing = useHostQuery(
    machineDiskListingQuery,
    host,
    target,
    { path: folder },
    { enabled: view === 'folders' && folder !== '' }
  )
  const largest = useHostQuery(
    machineDiskLargestQuery,
    host,
    target,
    { mount: mount?.mount ?? '', kind: view === 'files' ? 'files' : 'folders' },
    { enabled: view !== 'folders' && mount !== null }
  )
  // A finished scan changes the sizes on screen.
  const generation = disks?.generation ?? 0
  const { refetch: refetchListing } = listing
  const { refetch: refetchLargest } = largest
  useEffect(() => {
    if (generation > 0) {
      void refetchListing()
      void refetchLargest()
    }
  }, [generation, refetchLargest, refetchListing])

  const shown = view === 'folders' ? listing : largest
  const pending = t('seal.machines.disk.pending', 'not measured yet')
  const rows: DiskRow[] =
    view === 'folders'
      ? (listing.data?.entries ?? []).map((entry) => ({
          path: entry.path,
          name: entry.name,
          detail: null,
          kind: entry.kind,
          size:
            entry.bytes !== null
              ? formatMachineBytes(entry.bytes)
              : entry.unreadable
                ? t('seal.machines.disk.unreadable', 'no access')
                : entry.notIndexed
                  ? t('seal.machines.disk.notIndexed', 'not indexed')
                  : pending,
          opens: entry.kind === 'directory' ? entry.path : null
        }))
      : (largest.data?.items ?? []).map((item) => ({
          path: item.path,
          name: machinePathBasename(item.path),
          detail: machinePathDirname(item.path),
          kind: view === 'files' ? 'file' : 'directory',
          size: formatMachineBytes(item.bytes),
          opens: view === 'files' ? machinePathDirname(item.path) : item.path
        }))

  const scannedAt = view === 'folders' ? listing.data?.scannedAt : largest.data?.scannedAt
  const notes = [
    view === 'folders' && listing.data && listing.data.omittedCount > 0
      ? t('seal.machines.disk.omitted', '{{count}} smaller items ({{size}}) are not listed.', {
          count: listing.data.omittedCount,
          size: formatMachineBytes(listing.data.omittedBytes)
        })
      : null,
    view === 'folders' && listing.data?.incomplete
      ? t(
          'seal.machines.disk.incomplete',
          'Some folders could not be read, so the real total is larger.'
        )
      : null,
    scannedAt != null && disks
      ? t('seal.machines.disk.age', 'Sizes are from the index, {{age}} old.', {
          age: formatMachineUptime(Math.max(0, (disks.now - scannedAt) / 1000))
        })
      : null
  ].filter(Boolean)

  // One screen for the whole drill-down: Back leaves disk usage, the crumbs go up a folder.
  const open = (folderPath: string) => {
    setView('folders')
    router.setParams({ path: folderPath })
  }

  const header = (
    <View style={styles.detailHeader}>
      {disks ? (
        <MachineDiskMounts status={disks} activeMount={mount?.mount ?? null} onOpen={open} />
      ) : null}
      <MobileSegmentedControl
        segments={[
          { value: 'folders', label: t('seal.machines.disk.view.folders', 'Folders') },
          { value: 'files', label: t('seal.machines.disk.view.files', 'Largest files') },
          {
            value: 'largest-folders',
            label: t('seal.machines.disk.view.largestFolders', 'Largest folders')
          }
        ]}
        selected={view}
        onSelect={setView}
        fill
        tabs
      />
      {view === 'folders' && folder ? (
        <View style={styles.vitalRow}>
          <View style={styles.rowText}>
            <MachinePathCrumbs path={folder} onOpen={open} />
          </View>
          {listing.data && listing.data.totalBytes !== null ? (
            <Text style={styles.diskTotal}>{formatMachineBytes(listing.data.totalBytes)}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  )

  const screen = hostScreenState(
    { data: disks, error: status.error, isFetching: status.isFetching },
    connState
  )
  const retry = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => void status.refetch()
  })

  const body =
    screen === 'empty-offline' ? (
      <MobileOfflineState onReconnect={retry} />
    ) : screen === 'empty-error' ? (
      <MobileLoadErrorState
        error={status.error ?? t('seal.machines.disk.loadFailed', 'Unable to read disk usage')}
        onRetry={retry}
      />
    ) : screen !== 'data' ? (
      <MobileStateView loading title={t('seal.machines.disk.loading', 'Reading disk usage…')} />
    ) : (
      <FlatList
        data={rows}
        keyExtractor={(row) => row.path}
        renderItem={({ item }) => {
          const Icon = ROW_ICON[item.kind]
          const opens = item.opens
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && opens !== null && styles.rowPressed]}
              onPress={() => opens !== null && open(opens)}
              disabled={opens === null}
              accessibilityRole="button"
              accessibilityLabel={`${item.name} ${item.size}`}
            >
              <Icon size={20} color={colors.textMuted} strokeWidth={1.75} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={1} ellipsizeMode="middle">
                  {item.name}
                </Text>
                {item.detail ? (
                  <Text style={styles.rowMeta} numberOfLines={1} ellipsizeMode="head">
                    {item.detail}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.diskSize}>{item.size}</Text>
            </Pressable>
          )
        }}
        ListHeaderComponent={header}
        ListEmptyComponent={
          shown.isFetching ? (
            <View style={styles.footerStatus}>
              <ActivityIndicator size="small" color={colors.textMuted} />
            </View>
          ) : shown.error ? (
            <View style={styles.footerStatus}>
              <Text style={styles.inlineError}>{shown.error.message}</Text>
            </View>
          ) : (
            <MobileStateView
              icon={FolderOpen}
              title={
                view === 'folders'
                  ? t('seal.machines.browser.empty', 'This folder is empty')
                  : t('seal.machines.disk.noIndex', 'Nothing has been indexed here yet')
              }
            />
          )
        }
        ListFooterComponent={
          notes.length > 0 ? (
            <View style={styles.diskNotes}>
              <Text style={styles.footerText}>{notes.join(' ')}</Text>
            </View>
          ) : undefined
        }
        initialNumToRender={30}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
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
          title={t('seal.machines.disk.title', 'Disk usage')}
          subtitle={machine?.label ?? undefined}
          trailing={
            <NavBarButton
              icon={FolderOpen}
              onPress={() => router.push(machineDetailHref(hostId, machineId, folder))}
              disabled={!folder}
              accessibilityLabel={t('seal.machines.disk.showInFiles', 'Show in files')}
            />
          }
        />
      </SafeAreaView>
      {body}
    </View>
  )
}
