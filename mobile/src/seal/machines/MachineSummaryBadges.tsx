import { Text, View } from 'react-native'
import { translate } from '../../i18n/mobile-i18n'
import { colors } from '../../theme/mobile-theme'
import { useMobileColorScheme } from '../../theme/use-mobile-color-scheme'
import type { MobileMachineSummary } from './machine-reply-schemas'
import { machineScreenStyles as styles } from './machine-screen-styles'

function statusColor(status: MobileMachineSummary['status']): string {
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

export function machineStatusLabel(status: MobileMachineSummary['status']): string {
  switch (status) {
    case 'online':
      return translate('seal.machines.status.online', 'Online')
    case 'connecting':
      return translate('seal.machines.status.connecting', 'Connecting')
    case 'error':
      return translate('seal.machines.status.error', 'Error')
    case 'offline':
      return translate('seal.machines.status.offline', 'Offline')
  }
}

export function machineKindLabel(kind: MobileMachineSummary['kind']): string {
  switch (kind) {
    case 'local':
      return translate('seal.machines.kind.local', 'This computer')
    case 'ssh':
      return translate('seal.machines.kind.ssh', 'SSH')
    case 'runtime':
      return translate('seal.machines.kind.server', 'Seal server')
  }
}

export function MachineStatusDot({ status }: { status: MobileMachineSummary['status'] }) {
  useMobileColorScheme()
  return (
    <View
      style={[styles.statusDot, { backgroundColor: statusColor(status) }]}
      accessibilityLabel={machineStatusLabel(status)}
    />
  )
}

export function MachineKindBadge({ kind }: { kind: MobileMachineSummary['kind'] }) {
  useMobileColorScheme()
  return (
    <View style={styles.kindBadge}>
      <Text style={styles.kindBadgeText}>{machineKindLabel(kind)}</Text>
    </View>
  )
}
