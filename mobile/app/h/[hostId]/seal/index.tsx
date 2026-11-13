import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../src/navigation/route-param-reader'
import { SealHubScreen } from '../../../../src/seal/hub/SealHubScreen'

export default function SealHubRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  return <SealHubScreen key={hostId} hostId={hostId} />
}
