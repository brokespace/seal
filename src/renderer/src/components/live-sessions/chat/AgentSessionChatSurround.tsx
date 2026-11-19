import { useEffect, useMemo, useState } from 'react'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/rpc/targets/runtime-client-target'
import { useSessionMachineName } from '@/components/machines/model/use-local-machine-name'
import { openAppHttpLink } from '@/lib/browser/navigation/app-http-link-open'
import { normalizeExecutionHostId } from '../../../../../shared/execution-host'
import type { LiveSubagent } from '../../../../../shared/live-sessions/live-session-activity'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { recapViewOnSession } from '../../../../../shared/session-recap/session-recap-view'
import {
  LOCAL_USAGE_CREDENTIAL_HOST,
  type UsageCredentialHost
} from '../../settings/accounts/usage/usage-credential-host'
import { SessionRecapBar } from '../../session-recap/SessionRecapBar'
import { SessionRecapPanel } from '../../session-recap/SessionRecapPanel'
import type { SessionRecapModel } from '../../session-recap/use-session-recap'
import { useLiveSessionClock } from '../live-session-clock'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { useAgentSessionFocusRequest, type AgentSessionPanel } from './agent-session-focus-requests'
import { AgentSessionActivityPanel } from './AgentSessionActivityPanel'
import { AgentSessionHeader } from './AgentSessionHeader'
import { AgentSessionRecapReader } from './AgentSessionRecapReader'
import { AgentSessionSubagentTranscript } from './AgentSessionSubagentTranscript'
import { recapViewWithoutMessageJumps } from './recap-view-without-message-jumps'

const NO_RECAP: SessionRecapModel = {
  view: null,
  refreshing: false,
  failed: null,
  refresh: () => {},
  mark: () => {}
}

// Requests are numbered app-wide and only the newest is kept: one that was acted on stays acted on
// when its chat is mounted again.
let handledFocusNonce = 0

function openRecapLink(url: string): void {
  void openAppHttpLink(url)
}

type AgentSessionChatSurroundProps = {
  session: LiveSession
  /** False while the chat is kept behind another tab. */
  isVisible: boolean
  /** The subagent whose transcript shows in place of the chat. */
  openSubagent: LiveSubagent | null
  onOpenSubagent: (subagentId: string | null) => void
  /** Scrolls the chat to a message; absent when the chat cannot. */
  onRevealMessage?: (messageId: string) => void
  /** A recap to show instead of the host's; fixtures supply one. */
  recap?: SessionRecapModel
}

/**
 * What the frame draws around a session's chat, as cells of the frame's grid: the header, the
 * recap line, a subagent's transcript over the chat and the panel beside it.
 */
export function AgentSessionChatSurround({
  session,
  isVisible,
  openSubagent,
  onOpenSubagent,
  onRevealMessage,
  recap: givenRecap
}: AgentSessionChatSurroundProps): React.JSX.Element {
  const now = useLiveSessionClock()
  const [panel, setPanel] = useState<AgentSessionPanel | null>(null)
  const [readRecap, setReadRecap] = useState(NO_RECAP)
  const recap = givenRecap ?? readRecap
  const hasRecap = session.capabilities.recap
  const canReveal = onRevealMessage !== undefined
  const machineName = useSessionMachineName()
  const { status, lastActivityAt } = session
  // Read once, then kept in step with the row: a turn that starts takes "Not addressed" off at once.
  const recapView = useMemo(() => {
    if (!recap.view) {
      return null
    }
    const view = recapViewOnSession(recap.view, { status, lastActivityAt })
    return canReveal ? view : recapViewWithoutMessageJumps(view)
  }, [recap.view, canReveal, status, lastActivityAt])

  const { machine } = session
  // The recap is kept, and its settings live, on the Seal server that runs the session.
  const recapHost = useMemo<UsageCredentialHost>(
    () =>
      machine.connection === 'server'
        ? {
            owner:
              ipcOrRuntimeTargetForHostId(normalizeExecutionHostId(machine.executionHostId)) ??
              LOCAL_USAGE_CREDENTIAL_HOST.owner,
            label: machineName(machine)
          }
        : LOCAL_USAGE_CREDENTIAL_HOST,
    [machine, machineName]
  )

  // A menu elsewhere asked this view to show something.
  const request = useAgentSessionFocusRequest(session.id)
  useEffect(() => {
    if (!request || request.nonce <= handledFocusNonce) {
      return
    }
    handledFocusNonce = request.nonce
    if (request.target === 'composer' || request.target === 'permission') {
      // The chat answers these itself, so it must not sit behind a subagent's transcript.
      onOpenSubagent(null)
    } else {
      setPanel(request.target)
    }
  }, [request, onOpenSubagent])

  // What is on screen has been seen.
  useEffect(() => {
    if (isVisible) {
      liveSessionMarksStore.markSeen(session.id, session.lastActivityAt)
    }
  }, [isVisible, session.id, session.lastActivityAt])

  const toggle = (next: AgentSessionPanel): void =>
    setPanel((current) => (current === next ? null : next))
  const closePanel = (): void => setPanel(null)
  // A recap item's message lives in the session's own chat, behind any open subagent transcript.
  const onJump = (messageId: string): void => {
    onOpenSubagent(null)
    onRevealMessage?.(messageId)
  }

  return (
    <>
      {isVisible && hasRecap && !givenRecap ? (
        <AgentSessionRecapReader session={session} onModel={setReadRecap} />
      ) : null}
      <AgentSessionHeader
        session={session}
        panel={panel}
        onToggle={toggle}
        className="col-span-full row-start-1"
      />
      {hasRecap ? (
        <div className="@container col-span-full row-start-2 flex min-w-0 flex-col">
          <SessionRecapBar
            view={recapView}
            open={panel === 'recap'}
            now={now}
            onToggle={() => toggle('recap')}
          />
        </div>
      ) : null}
      {openSubagent ? (
        <AgentSessionSubagentTranscript
          key={openSubagent.id}
          session={session}
          subagent={openSubagent}
          isVisible={isVisible}
          onBack={() => onOpenSubagent(null)}
          className="col-start-1 row-start-3"
        />
      ) : null}
      {panel === 'recap' ? (
        hasRecap ? (
          <div className="col-start-2 row-start-3 flex min-h-0">
            <SessionRecapPanel
              view={recapView}
              refreshing={recap.refreshing}
              failed={recap.failed}
              now={now}
              onRefresh={recap.refresh}
              onMark={recap.mark}
              onJump={onJump}
              onOpenLink={openRecapLink}
              host={recapHost}
              onClose={closePanel}
            />
          </div>
        ) : null
      ) : panel ? (
        <div className="col-start-2 row-start-3 flex min-h-0">
          <AgentSessionActivityPanel
            panel={panel}
            provider={session.provider}
            activity={session.activity}
            openSubagentId={openSubagent?.id ?? null}
            onOpenSubagent={(id) => onOpenSubagent(id === openSubagent?.id ? null : id)}
            onClose={closePanel}
            now={now}
          />
        </div>
      ) : null}
    </>
  )
}
