import { useEffect, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { useLocalMachineName } from '../../machines/model/use-local-machine-name'
import { useMachinesInventory } from '../../machines/model/use-machines-inventory'
import { NativeChatEmptyState } from '../../native-chat/host-access/NativeChatEmptyState'

function Unavailable(): React.JSX.Element {
  const t = useTranslate()
  return (
    <NativeChatEmptyState
      kind="empty"
      headline={t('seal.sessionTab.unavailable', 'This session is no longer available')}
    />
  )
}

function Reconnecting({ machine }: { machine: string }): React.JSX.Element {
  const t = useTranslate()
  return (
    <NativeChatEmptyState
      kind="loading"
      headline={t('seal.sessionTab.reconnecting', 'Reconnecting to {{machine}}…', { machine })}
    />
  )
}

/** A machine that just connected has not said which sessions it runs: the wait for its answer. */
function UnlistedOnConnectedMachine({
  hostId,
  machine
}: {
  hostId: string
  machine: string
}): React.JSX.Element {
  const [answered, setAnswered] = useState(false)
  useEffect(() => {
    let live = true
    const settle = (): void => {
      if (live) {
        setAnswered(true)
      }
    }
    void window.api.liveSessions.refresh(hostId).then(settle, settle)
    return () => {
      live = false
    }
  }, [hostId])
  return answered ? <Unavailable /> : <Reconnecting machine={machine} />
}

/**
 * In the transcript's place while the registry lists no such session. A session's id begins with
 * its machine's record id: until Seal has reconnected to that machine and read its sessions, the
 * session is not gone.
 */
export function ExternalAgentSessionUnlisted({
  sessionId
}: {
  sessionId: string
}): React.JSX.Element {
  const { machines, views, loaded } = useMachinesInventory(useLocalMachineName())
  if (!loaded) {
    return <NativeChatEmptyState kind="loading" />
  }
  const view = views.find((candidate) => sessionId.startsWith(`${candidate.recordId}:`))
  const machine = view && machines.find((candidate) => candidate.id === view.id)
  if (machine?.status === 'connecting') {
    return <Reconnecting machine={machine.label} />
  }
  if (view && machine?.status === 'online') {
    return <UnlistedOnConnectedMachine hostId={view.recordId} machine={machine.label} />
  }
  return <Unavailable />
}
