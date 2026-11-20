import { useCallback, useState } from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, Server } from 'lucide-react-native'
import { useQueryClient } from '@tanstack/react-query'
import {
  MobileLoadErrorState,
  MobileOfflineState,
  MobileStateView
} from '../../components/MobileStateView'
import { NavBar } from '../../components/nav-bar/NavBar'
import { NavBarButton } from '../../components/nav-bar/NavBarButton'
import { HOST_LIST_TARGET, NO_HOST_LIST_INPUT } from '../../host-screen/catalog/host-list-queries'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useHostQuery } from '../../query/host-query'
import { hostScopeKey } from '../../query/host-query-key'
import { hostScreenState } from '../../query/host-query-screen-state'
import { useRefreshHint } from '../../query/refresh-hint'
import { connectionRetryAction } from '../../transport/connection/connection-retry-action'
import { useForceReconnect, useHostClient } from '../../transport/connection/host-client-hooks'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { colors, pressedStyle } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import { machineMetricsQuery, machineQueryTarget, machinesListQuery } from './machine-operations'
import type { MobileMachineSummary } from './machine-reply-schemas'
import { machineDetailHref } from './machine-routes'
import { machineScreenStyles as styles } from './machine-screen-styles'
import { machineOsLabel } from './machine-vitals-format'
import { MachineKindBadge, MachineStatusDot, machineStatusLabel } from './MachineSummaryBadges'
import { MachineVitalsBars } from './MachineVitalsBars'

const NO_INPUT = {}

function MachineCard({
  hostId,
  client,
  machine,
  onOpen
}: {
  hostId: string
  client: RpcClient | null
  machine: MobileMachineSummary
  onOpen: (machine: MobileMachineSummary) => void
}) {
  useMobileColorScheme()
  // Only rows FlatList mounts ask for stats, so a long list stays cheap.
  const metrics = useHostQuery(
    machineMetricsQuery,
    { hostId, client },
    machineQueryTarget(machine.id),
    NO_INPUT,
    { enabled: machine.status === 'online' }
  )
  const os = machineOsLabel(metrics.data?.os ?? machine.os)
  const subtitle = [machine.address, os, metrics.data?.osRelease].filter(Boolean).join(' · ')
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && pressedStyle]}
      onPress={() => onOpen(machine)}
      accessibilityRole="button"
      accessibilityLabel={`${machine.label}, ${machineStatusLabel(machine.status)}`}
    >
      <View style={styles.cardTitleRow}>
        <MachineStatusDot status={machine.status} />
        <Text style={styles.cardTitle} numberOfLines={1}>
          {machine.label}
        </Text>
        <MachineKindBadge kind={machine.kind} />
      </View>
      {subtitle ? (
        <Text style={[styles.cardMeta, styles.mono]} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {machine.statusDetail ? (
        <Text style={styles.inlineError} numberOfLines={2}>
          {machine.statusDetail}
        </Text>
      ) : null}
      {machine.status === 'online' ? (
        <MachineVitalsBars metrics={metrics.data} loading={metrics.isFetching} />
      ) : null}
    </Pressable>
  )
}

export function MachinesListScreen({ hostId }: { hostId: string }) {
  useMobileColorScheme()
  const t = useMobileTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const forceReconnect = useForceReconnect()
  const { client, state: connState } = useHostClient(hostId)
  const list = useHostQuery(
    machinesListQuery,
    { hostId, client },
    HOST_LIST_TARGET,
    NO_HOST_LIST_INPUT
  )
  const [pulling, setPulling] = useState(false)
  const refreshing = useRefreshHint(list.isRefetching && !pulling)

  const refresh = useCallback(async () => {
    setPulling(true)
    try {
      await Promise.all([
        list.refetch(),
        queryClient.invalidateQueries({
          queryKey: [...hostScopeKey(hostId), machineMetricsQuery.family]
        })
      ])
    } finally {
      setPulling(false)
    }
  }, [hostId, list, queryClient])

  const open = useCallback(
    (machine: MobileMachineSummary) => router.push(machineDetailHref(hostId, machine.id)),
    [hostId, router]
  )

  const screen = hostScreenState(
    { data: list.data, error: list.error, isFetching: list.isFetching },
    connState
  )
  const retry = connectionRetryAction({
    hostId,
    needsReconnect: connState !== 'connected',
    forceReconnect,
    reload: () => void list.refetch()
  })

  const body =
    screen === 'empty-offline' ? (
      <MobileOfflineState onReconnect={retry} />
    ) : screen === 'empty-error' ? (
      <MobileLoadErrorState
        error={list.error ?? t('seal.machines.list.loadFailed', 'Unable to load machines')}
        onRetry={retry}
      />
    ) : screen !== 'data' ? (
      <MobileStateView loading title={t('seal.machines.list.loading', 'Loading machines…')} />
    ) : (
      <FlatList
        data={list.data}
        keyExtractor={(machine) => machine.id}
        renderItem={({ item }) => (
          <MachineCard hostId={hostId} client={client} machine={item} onOpen={open} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={pulling}
            onRefresh={() => void refresh()}
            tintColor={colors.textMuted}
          />
        }
        ListEmptyComponent={
          <MobileStateView icon={Server} title={t('seal.machines.list.empty', 'No machines')} />
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
          title={t('seal.machines.list.title', 'Machines')}
          refreshing={refreshing}
        />
      </SafeAreaView>
      {body}
    </View>
  )
}
