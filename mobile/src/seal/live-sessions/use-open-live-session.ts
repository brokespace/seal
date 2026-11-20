import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouteHandoff } from '../../navigation/route-handoff'
import {
  mobileStructuredSessionHref,
  openMobileStructuredSession
} from '../../session/native-chat/agent-session/open-mobile-structured-session'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { sealSessionHref } from '../seal-route-hrefs'
import type { LiveSession } from './live-session-schemas'
import { liveSessionWorktreeId, type KnownSessionWorkspace } from './live-session-workspace-place'

/**
 * Opens a session from a list. A chat opens as chats do, in its workspace's own tab; a CLI or an
 * external session, and a chat whose workspace this phone can't tell, opens the registry's chat.
 */
export function useOpenLiveSession(
  hostId: string,
  client: RpcClient | null,
  workspaces: readonly KnownSessionWorkspace[]
): { open: (session: LiveSession) => void; openingId: string | null } {
  const router = useRouteHandoff()
  const [openingId, setOpeningId] = useState<string | null>(null)
  // The newest press owns the navigation: an earlier chat's late answer opens nothing.
  const asked = useRef(0)
  useEffect(
    () => () => {
      asked.current++
    },
    []
  )
  const open = useCallback(
    (session: LiveSession) => {
      const turn = ++asked.current
      const { surface } = session
      const worktreeId = liveSessionWorktreeId(session, workspaces)
      if (surface?.kind !== 'chat' || !client || !worktreeId) {
        setOpeningId(null)
        router.push(sealSessionHref(hostId, session.id))
        return
      }
      setOpeningId(session.id)
      const settle = (href: string) => {
        if (asked.current === turn) {
          setOpeningId(null)
          router.push(href)
        }
      }
      void openMobileStructuredSession({
        client,
        source: {
          kind: 'notification',
          sessionId: surface.sessionId,
          worktreeId,
          agent: session.provider
        },
        current: () => asked.current === turn
      }).then(
        (result) =>
          settle(
            result.kind === 'opened'
              ? mobileStructuredSessionHref(hostId, result.target, result.tab)
              : sealSessionHref(hostId, session.id)
          ),
        () => settle(sealSessionHref(hostId, session.id))
      )
    },
    [client, hostId, router, workspaces]
  )
  return { open, openingId }
}
