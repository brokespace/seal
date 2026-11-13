import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import type { HomeChatOpenTarget } from '../../../../shared/home-chat/home-chat-types'
import type { MachineId } from '../../../../shared/machines/machine-types'
import { takeOverLiveSession } from '../live-sessions/take-over/live-session-take-over'
import { rememberMachineSelection } from '../machines/model/machine-selection'

async function takeOver(sessionId: string): Promise<void> {
  const snapshot = await window.api.liveSessions.snapshot().catch(() => null)
  const session = snapshot?.sessions.find((candidate) => candidate.id === sessionId)
  if (!session) {
    toast.error(translate('homeChat.open.sessionGone', 'That agent session is no longer running.'))
    return
  }
  await takeOverLiveSession(session)
}

/** Carries out what the assistant asked Seal's window to show. */
export function openHomeChatTarget(
  target: HomeChatOpenTarget,
  selectThread: (chatId: string) => void
): void {
  const store = useAppStore.getState()
  switch (target.kind) {
    case 'thread':
      selectThread(target.chatId)
      return
    case 'machine':
      rememberMachineSelection(target.machineId as MachineId)
      store.openMachinesPage()
      return
    case 'take-over':
      void takeOver(target.sessionId)
      return
    case 'view':
      switch (target.view) {
        case 'home':
          store.setActiveView('home')
          return
        case 'machines':
          store.openMachinesPage()
          return
        case 'sessions':
          store.openSessionsPage()
          return
        case 'tasks':
          store.openTaskPage()
          return
        case 'activity':
          store.openActivityPage()
          return
        case 'automations':
          store.openAutomationsPage()
          return
        case 'skills':
          store.openSkillsPage()
          return
        case 'settings':
          store.openSettingsPage()
      }
  }
}
