import { useMemo } from 'react'
import { Linking } from 'react-native'
import type { LiveSession } from '../../../../src/shared/live-sessions/live-session-types'
import { recapViewOnSession } from '../../../../src/shared/session-recap/session-recap-view'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { SessionRecapSheet } from './SessionRecapSheet'
import { useSessionRecap } from './use-session-recap'

/** A session's recap on the phone: read while its chat is open, shown as a sheet from the chat's menu. */
export function SessionRecapOverview({
  client,
  session,
  open,
  onClose
}: {
  client: RpcClient | null
  session: Pick<LiveSession, 'id' | 'recap' | 'status' | 'lastActivityAt'>
  open: boolean
  onClose: () => void
}) {
  const recap = useSessionRecap(client, session.id, session.recap)
  const { status, lastActivityAt } = session
  // Read once, then kept in step with the row: a turn that starts takes "Not addressed" off at once.
  const view = useMemo(
    () => (recap.view ? recapViewOnSession(recap.view, { status, lastActivityAt }) : null),
    [recap.view, status, lastActivityAt]
  )
  return (
    <SessionRecapSheet
      visible={open}
      view={view}
      refreshing={recap.refreshing}
      failed={recap.failed}
      onRefresh={recap.refresh}
      onMark={recap.mark}
      onOpenLink={(url) => void Linking.openURL(url)}
      onClose={onClose}
    />
  )
}
