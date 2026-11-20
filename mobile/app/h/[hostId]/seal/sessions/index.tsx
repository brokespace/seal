import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../../src/navigation/route-param-reader'
import { LiveSessionsScreen } from '../../../../../src/seal/live-sessions/LiveSessionsScreen'

export default function LiveSessionsRoute() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  return <LiveSessionsScreen key={hostId} hostId={hostId} />
}
