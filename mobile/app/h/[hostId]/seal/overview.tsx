import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../src/navigation/route-param-reader'
import { SealOverviewScreen } from '../../../../src/seal/overview/SealOverviewScreen'

export default function SealOverviewRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  return <SealOverviewScreen key={hostId} hostId={hostId} />
}
