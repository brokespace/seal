import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '../../store/index'
import { useTranslate } from '@/i18n/use-translate'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/files/access/file-owner-runtime-target'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { SealSessionLiveSwapMode } from '../../../../shared/seal-accounts/seal-accounts-status'
import { SealSessionAccountMenu } from './SealSessionAccountMenu'
import { sessionForTab } from './seal-session-account-view'
import { mutateSealHost, sealHostSnapshot, subscribeSealHost } from './seal-session-status-store'

/** Empty string is the local host; null means the owner is ambiguous, so no badge. */
function ownerEnvironment(target: RuntimeClientTarget | null): string | null {
  if (!target) {
    return null
  }
  return target.kind === 'local' ? '' : target.environmentId
}

/** The account a Seal-launched agent in this tab runs on, with a menu to move it. */
export function SealTabAccountBadge({
  tabId,
  worktreeId
}: {
  tabId: string
  worktreeId: string | null | undefined
}) {
  const t = useTranslate()
  const environment = useAppStore((state) =>
    ownerEnvironment(getRuntimeTargetForWorktreeOwner(state, worktreeId))
  )
  const target = useMemo<RuntimeClientTarget | null>(
    () =>
      environment === null
        ? null
        : environment === ''
          ? { kind: 'local' }
          : { kind: 'environment', environmentId: environment },
    [environment]
  )
  const subscribe = useCallback(
    (listener: () => void) => (target ? subscribeSealHost(target, listener) : () => {}),
    [target]
  )
  const snapshot = useSyncExternalStore(subscribe, () => (target ? sealHostSnapshot(target) : null))
  const session = snapshot ? sessionForTab(snapshot.status.sessions, tabId) : null
  if (!target || !snapshot || !session) {
    return null
  }
  return (
    <SealSessionAccountMenu
      className="mr-1"
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
