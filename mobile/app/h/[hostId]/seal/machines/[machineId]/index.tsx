import { useLocalSearchParams } from 'expo-router'
import { PageRouteUnavailableScreen } from '../../../../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { MachineDetailScreen } from '../../../../../../src/seal/machines/MachineDetailScreen'
import {
  readMachineRoute,
  type MachineRouteParams
} from '../../../../../../src/seal/machines/machine-routes'

export default function SealMachineDetailRoute() {
  const { hostId, machineId, path } = readMachineRoute(useLocalSearchParams<MachineRouteParams>())
  if (!hostId || !machineId) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return (
    <MachineDetailScreen
      key={`${hostId}\n${machineId}\n${path}`}
      hostId={hostId}
      machineId={machineId}
      path={path}
    />
  )
}
