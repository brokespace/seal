import { useCallback, useState } from 'react'
import { cn } from '@/lib/class-names'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import type { SessionRecapModel } from '../../session-recap/use-session-recap'
import { AgentSessionChatSurround } from './AgentSessionChatSurround'
import { useAgentSessionRecord, type AgentSessionFrameLookup } from './use-agent-session-record'

export type { AgentSessionFrameLookup }

type AgentSessionChatFrameViewProps = {
  /** Null while the registry lists no record for the chat: the chat shows alone. */
  session: LiveSession | null
  isVisible: boolean
  /** Scrolls the transcript to a message; absent when the view cannot. */
  onRevealMessage?: (messageId: string) => void
  /** A recap to show instead of the host's; fixtures supply one. */
  recap?: SessionRecapModel
  children: React.ReactNode
}

/** The frame around a chat whose record is already known; fixtures render it without a registry. */
export function AgentSessionChatFrameView({
  session,
  isVisible,
  onRevealMessage,
  recap,
  children
}: AgentSessionChatFrameViewProps): React.JSX.Element {
  const [opened, setOpened] = useState<{ sessionId: string; subagentId: string } | null>(null)
  const sessionId = session?.id ?? null
  const openSubagent =
    (session && opened?.sessionId === session.id
      ? session.activity?.subagents.find((subagent) => subagent.id === opened.subagentId)
      : null) ?? null
  const onOpenSubagent = useCallback(
    (subagentId: string | null) =>
      setOpened(sessionId && subagentId ? { sessionId, subagentId } : null),
    [sessionId]
  )
  return (
    // A grid: one sibling draws the header and the panel, so the chat is not remounted when its record comes or goes.
    <div
      data-live-session-pane={sessionId ?? undefined}
      className="grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] grid-rows-[auto_auto_minmax(0,1fr)]"
    >
      {session ? (
        <AgentSessionChatSurround
          key={session.id}
          session={session}
          isVisible={isVisible}
          openSubagent={openSubagent}
          onOpenSubagent={onOpenSubagent}
          onRevealMessage={onRevealMessage}
          recap={recap}
        />
      ) : null}
      <div
        // Under a subagent's transcript the chat stays mounted but takes no focus and no clicks.
        inert={openSubagent !== null}
        className={cn(
          'relative col-start-1 row-start-3 flex min-h-0 min-w-0 flex-col',
          openSubagent && 'invisible'
        )}
      >
        {children}
      </div>
    </div>
  )
}

type AgentSessionChatFrameProps = {
  lookup: AgentSessionFrameLookup
  isVisible: boolean
  /** Scrolls the transcript to a message; absent when the view cannot. */
  onRevealMessage?: (messageId: string) => void
  /** The chat view; it keeps filling the frame. */
  children: React.ReactNode
}

/**
 * Around every session's chat (a structured chat, a terminal's chat view, an external session's
 * tab): the session's header, recap line and side panels. A chat with no record shows alone.
 */
export function AgentSessionChatFrame({
  lookup,
  isVisible,
  onRevealMessage,
  children
}: AgentSessionChatFrameProps): React.JSX.Element {
  const session = useAgentSessionRecord(lookup)
  return (
    <AgentSessionChatFrameView
      session={session}
      isVisible={isVisible}
      onRevealMessage={onRevealMessage}
    >
      {children}
    </AgentSessionChatFrameView>
  )
}
