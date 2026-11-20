import { useLocalSearchParams } from 'expo-router'
import { firstParam } from '../../../../../src/navigation/route-param-reader'
import { LiveSessionChatScreen } from '../../../../../src/seal/live-sessions/LiveSessionChatScreen'

export default function LiveSessionChatRoute() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    sessionId?: string | string[]
  }>()
  const hostId = firstParam(params.hostId)
  const sessionId = firstParam(params.sessionId)
  return (
    <LiveSessionChatScreen key={`${hostId}\0${sessionId}`} hostId={hostId} sessionId={sessionId} />
  )
}
