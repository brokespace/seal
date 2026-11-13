import { useLocalSearchParams } from 'expo-router'
import { PageRouteUnavailableScreen } from '../../../../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { MachineFilePreviewScreen } from '../../../../../../src/seal/machines/MachineFilePreviewScreen'
import {
  readMachineRoute,
  type MachineRouteParams
} from '../../../../../../src/seal/machines/machine-routes'

export default function SealMachineFilePreviewRoute() {
  const { hostId, machineId, path, size } =
    readMachineRoute(useLocalSearchParams<MachineRouteParams>())
  if (!hostId || !machineId || !path) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return (
    <MachineFilePreviewScreen
      key={`${hostId}\n${machineId}\n${path}`}
      hostId={hostId}
      machineId={machineId}
      path={path}
      size={size}
    />
  )
}
