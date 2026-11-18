import { useMemo } from 'react'
import { useAppStore } from '../../store/index'
import { useTranslate } from '@/i18n/use-translate'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealSessionLiveSwapMode } from '../../../../shared/seal-accounts/seal-accounts-status'
import { SealSessionAccountMenu } from './SealSessionAccountMenu'
import { sessionForChat, sessionForTab } from './seal-session-account-view'
import { mutateSealHost } from './seal-session-status-store'
import { useSealHostSnapshot } from './use-seal-host-snapshot'

/** Empty string is the local host; null means the owner is ambiguous, so no badge. */
function ownerEnvironment(target: RuntimeClientTarget | null): string | null {
  if (!target) {
    return null
  }
  return target.kind === 'local' ? '' : target.environmentId
}

/**
 * The account a Seal-launched agent runs on, with its usage and a menu to move it: a chat by its
 * session id, or a terminal agent by its tab.
 */
export function SealSessionAccountBadge({
  tabId,
  chatSessionId,
  worktreeId,
  runtimeEnvironmentId,
  className = 'mr-1'
}: {
  tabId?: string
  chatSessionId?: string
  worktreeId: string | null | undefined
  /** The host a chat runs on, when the caller knows it better than the workspace's owner. */
  runtimeEnvironmentId?: string | null
  className?: string
}) {
  const t = useTranslate()
  const ownerEnvironmentId = useAppStore((state) =>
    ownerEnvironment(getRuntimeTargetForWorktreeOwner(state, worktreeId))
  )
  const environment = runtimeEnvironmentId ?? ownerEnvironmentId
  const target = useMemo<RuntimeClientTarget | null>(
    () =>
      environment === null
        ? null
        : environment === ''
          ? { kind: 'local' }
          : { kind: 'environment', environmentId: environment },
    [environment]
  )
  const snapshot = useSealHostSnapshot(target)
  const sessions = snapshot?.status.sessions ?? []
  const session = chatSessionId
    ? sessionForChat(sessions, chatSessionId)
    : tabId
      ? sessionForTab(sessions, tabId)
      : null
  if (!target || !snapshot || !session) {
    return null
  }
  return (
    <SealSessionAccountMenu
      className={className}
      session={session}
      candidates={snapshot.status.providers[session.provider].candidates}
      readAt={snapshot.readAt}
      onSwap={(account) =>
        void mutateSealHost(
          target,
          'seal.accounts.swapSession',
          { sessionId: session.id, account },
          t('seal.session.error.swap', 'Could not switch this session')
        )
      }
      onSetLiveSwap={(mode: SealSessionLiveSwapMode) =>
        void mutateSealHost(
          target,
          'seal.accounts.setSessionLiveSwap',
          { sessionId: session.id, mode },
          t('seal.session.error.liveSwap', 'Could not change this session’s setting')
        )
      }
    />
  )
}
