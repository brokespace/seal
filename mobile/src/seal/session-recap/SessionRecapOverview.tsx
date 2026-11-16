import { Linking } from 'react-native'
import type { LiveSessionRecapBrief } from '../../../../src/shared/session-recap/session-recap-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { SessionRecapSheet } from './SessionRecapSheet'
import { useSessionRecap } from './use-session-recap'

/** A session's recap on the phone: read while its chat is open, shown as a sheet from the chat's menu. */
export function SessionRecapOverview({
  client,
  sessionId,
  brief,
  open,
  onClose
}: {
  client: RpcClient | null
  sessionId: string
  brief: LiveSessionRecapBrief | undefined
  open: boolean
  onClose: () => void
}) {
  const recap = useSessionRecap(client, sessionId, brief)
  return (
    <SessionRecapSheet
      visible={open}
      view={recap.view}
      refreshing={recap.refreshing}
      onRefresh={recap.refresh}
      onMark={recap.mark}
      onOpenLink={(url) => void Linking.openURL(url)}
      onClose={onClose}
    />
  )
}
