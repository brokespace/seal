import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../../src/navigation/route-param-reader'
import { LiveSessionDetailScreen } from '../../../../../src/seal/live-sessions/LiveSessionDetailScreen'

export default function LiveSessionDetailRoute() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    sessionId?: string | string[]
  }>()
  const hostId = firstParam(params.hostId)
  const sessionId = firstParam(params.sessionId)
  return (
    <LiveSessionDetailScreen
      key={`${hostId}\0${sessionId}`}
      hostId={hostId}
      sessionId={sessionId}
    />
  )
}
