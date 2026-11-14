import { useState } from 'react'
import { Linking } from 'react-native'
import type { LiveSessionRecapBrief } from '../../../../src/shared/session-recap/session-recap-types'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { SessionRecapBanner } from './SessionRecapBanner'
import { SessionRecapSheet } from './SessionRecapSheet'
import { useSessionRecap } from './use-session-recap'

/** A session's recap on the phone: a line above the transcript that opens the whole recap in a sheet. */
export function SessionRecapOverview({
  client,
  sessionId,
  brief,
  onJump
}: {
  client: RpcClient | null
  sessionId: string
  brief: LiveSessionRecapBrief | undefined
  /** Shows a transcript message; the sheet closes first so the message is in view. */
  onJump: (messageId: string) => void
}) {
  const recap = useSessionRecap(client, sessionId, brief)
  const [open, setOpen] = useState(false)
  return (
    <>
      <SessionRecapBanner view={recap.view} onOpen={() => setOpen(true)} />
      <SessionRecapSheet
        visible={open}
        view={recap.view}
        refreshing={recap.refreshing}
        onRefresh={recap.refresh}
        onMark={recap.mark}
        onJump={(messageId) => {
          setOpen(false)
          onJump(messageId)
        }}
        onOpenLink={(url) => void Linking.openURL(url)}
        onClose={() => setOpen(false)}
      />
    </>
  )
}
