import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import type { HomeChatOpenTarget } from '../../../../shared/home-chat/home-chat-types'
import { parseMachineId } from '../../../../shared/machines/machine-types'
import { isActiveLiveSession } from '../../../../shared/live-sessions/live-session-status'
import { compareListedLiveSessions } from '../../../../shared/live-sessions/live-session-summary'
import { liveSessionRegistryStore } from '../live-sessions/live-session-registry-store'
import { takeOverLiveSession } from '../live-sessions/take-over/live-session-take-over'
import { revealFirstListedSession } from '../live-sessions/workspace-rows/session-row-reveal'
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

/** Sessions are listed under their workspaces in the sidebar: open it on the one that most needs a look. */
function revealSessionsInSidebar(): void {
  useAppStore.getState().setSidebarOpen(true)
  const running = liveSessionRegistryStore
    .getState()
    .sessions.filter(isActiveLiveSession)
    .sort(compareListedLiveSessions)
  if (running.length > 0) {
    revealFirstListedSession(running.map((session) => session.id))
  }
}

type ThreadSelector = (chatId: string) => void

let selectThread: ThreadSelector | null = null
let pendingThread: string | null = null

/** The assistant panel shows a requested thread; one asked for while it is closed waits for it. */
export function registerHomeChatThreadSelector(select: ThreadSelector): () => void {
  selectThread = select
  if (pendingThread) {
    select(pendingThread)
    pendingThread = null
  }
  return () => {
    if (selectThread === select) {
      selectThread = null
    }
  }
}

/** Listens on every page: the assistant also runs while its panel is not on screen. */
export function subscribeHomeChatOpenRequests(): () => void {
  return (
    window.api.homeChat?.onEvent((event) => {
      if (event.type === 'open') {
        openHomeChatTarget(event.target)
      }
    }) ?? (() => {})
  )
}

/** Carries out what the assistant asked Seal's window to show. */
export function openHomeChatTarget(target: HomeChatOpenTarget): void {
  const store = useAppStore.getState()
  switch (target.kind) {
    case 'thread':
      store.setActiveView('home')
      if (selectThread) {
        selectThread(target.chatId)
      } else {
        pendingThread = target.chatId
      }
      return
    case 'machine': {
      const machineId = parseMachineId(target.machineId)
      if (machineId) {
        rememberMachineSelection(machineId)
      }
      store.openMachinesPage()
      return
    }
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
        // Agent activity is the sidebar's session rows; the upstream Activity page lists panes only.
        case 'sessions':
        case 'activity':
          revealSessionsInSidebar()
          return
        case 'tasks':
          store.openTaskPage()
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
