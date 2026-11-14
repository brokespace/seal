import { useLocalSearchParams } from 'expo-router'
import { PageRouteUnavailableScreen } from '../../../../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { MachineDiskScreen } from '../../../../../../src/seal/machines/MachineDiskScreen'
import {
  readMachineRoute,
  type MachineRouteParams
} from '../../../../../../src/seal/machines/machine-routes'

export default function SealMachineDiskRoute() {
  const { hostId, machineId, path } = readMachineRoute(useLocalSearchParams<MachineRouteParams>())
  if (!hostId || !machineId) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return <MachineDiskScreen hostId={hostId} machineId={machineId} path={path} />
}
