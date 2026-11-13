import { View } from 'react-native'
import {
  machineDiskUsedPercent,
  machineLoad,
  machineMemoryUsedPercent
} from '../../../../src/shared/home-overview/home-machine-readings'
import { ListRow } from '../../components/list/ListGroup'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useHostQuery } from '../../query/host-query'
import { colors, radii } from '../../theme/mobile-theme'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import {
  SEAL_OVERVIEW_TARGET,
  sealOverviewMetricsQuery,
  type SealMachineSummary
} from './seal-overview-machines'

const percent = (value: number | undefined) => (value === undefined ? '–' : `${Math.round(value)}%`)

function statusColor(status: SealMachineSummary['status']): string {
  switch (status) {
    case 'online':
      return colors.statusGreen
    case 'connecting':
      return colors.statusAmber
    case 'error':
      return colors.statusRed
    case 'offline':
      return colors.textMuted
  }
}

/** A machine with its status dot and, once its own read lands, a CPU · memory · disk line. */
export function SealOverviewMachineRow({
  hostId,
  client,
  machine,
  onPress
}: {
  hostId: string
  client: RpcClient | null
  machine: SealMachineSummary
  onPress: () => void
}) {
  const t = useMobileTranslation()
  const online = machine.status === 'online'
  const metrics = useHostQuery(
    sealOverviewMetricsQuery,
    { hostId, client },
    SEAL_OVERVIEW_TARGET,
    { machineId: machine.id },
    { enabled: online }
  )
  const load = machineLoad(metrics.data)
  let subtitle: string | undefined
  if (!online) {
    subtitle =
      machine.statusDetail ??
      (machine.status === 'connecting'
        ? t('seal.overview.machineConnecting', 'Connecting')
        : machine.status === 'error'
          ? t('seal.overview.machineError', 'Unreachable')
          : t('seal.overview.machineOffline', 'Offline'))
  } else if (metrics.data) {
    subtitle = t(
      'seal.overview.machineReadings',
      'CPU {{value0}} · Mem {{value1}} · Disk {{value2}}',
      {
        value0: percent(load === undefined ? undefined : load * 100),
        value1: percent(machineMemoryUsedPercent(metrics.data)),
        value2: percent(machineDiskUsedPercent(metrics.data))
      }
    )
  } else if (metrics.isError) {
    subtitle = t('seal.overview.metricsUnavailable', 'Metrics unavailable')
  } else {
    subtitle = t('seal.overview.metricsLoading', 'Reading metrics…')
  }
  return (
    <ListRow
      title={machine.label}
      subtitle={subtitle}
      leading={
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: radii.pill,
            backgroundColor: statusColor(machine.status)
          }}
        />
      }
      navigates
      onPress={onPress}
    />
  )
}
