import { useLocalSearchParams } from 'expo-router'
import { PageRouteUnavailableScreen } from '../../../../../src/mobile-web-shell/PageRouteUnavailableScreen'
import { firstParam } from '../../../../../src/navigation/route-param-reader'
import { MachinesListScreen } from '../../../../../src/seal/machines/MachinesListScreen'

export default function SealMachinesRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  if (!hostId) {
    return <PageRouteUnavailableScreen hostId={hostId} />
  }
  return <MachinesListScreen key={hostId} hostId={hostId} />
}
