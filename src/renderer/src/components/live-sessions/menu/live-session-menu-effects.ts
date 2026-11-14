import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { buildAiVaultResumeCommand } from '../../../../../shared/ai-vault/resume/ai-vault-resume-command'
import {
  compareLiveSessions,
  isActiveLiveSession
} from '../../../../../shared/live-sessions/live-session-status'
import { liveSessionMachineId } from '../../../../../shared/live-sessions/live-session-machine-id'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { parseMachineId } from '../../../../../shared/machines/machine-types'
import { rememberMachineSelection } from '../../machines/model/machine-selection'
import { mutateSealHost } from '../../seal-session/seal-session-status-store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { ACTIVE_AGENTS_COLLAPSE_KEY } from '../active-agents/active-agents-model'
import { liveSessionMarksStore } from '../live-session-marks-store'
import { takeOverLiveSession } from '../take-over/live-session-take-over'
import {
  liveSessionTabsStore,
  type LiveSessionFocusTarget,
  type LiveSessionOpenMode
} from '../workspace/live-session-tabs-store'
import { liveSessionDialogStore } from './live-session-dialog-store'
import type { LiveSessionMenuEffects } from './live-session-menu'
import { sealAssignmentFor } from './live-session-accounts'

/** Shows a session's chat in the main area, as a tab. */
export function openLiveSessionView(
  sessionId: string,
  mode: LiveSessionOpenMode = 'preview'
): void {
  const id = liveSessionRegistryStore.currentId(sessionId)
  liveSessionTabsStore.open(id, mode)
  useAppStore.getState().openAgentSessionTabs()
  liveSessionMarksStore.reveal(id)
}

/** A click on a session's row, on any surface: a preview tab, kept on double-click. */
export function openLiveSessionFromRow(session: LiveSession, event?: { type: string }): void {
  openLiveSessionView(session.id, event?.type === 'dblclick' ? 'tab' : 'preview')
}

/**
 * Where links to the former Agent sessions page land: the open session tabs, or the session that
 * most needs a look, with Active agents unfolded in the sidebar.
 */
export function showActiveAgents(): void {
  const store = useAppStore.getState()
  if (store.collapsedGroups.has(ACTIVE_AGENTS_COLLAPSE_KEY)) {
    store.toggleCollapsedGroup(ACTIVE_AGENTS_COLLAPSE_KEY)
  }
  const { sessions } = liveSessionRegistryStore.getState()
  const next = [...sessions].filter(isActiveLiveSession).sort(compareLiveSessions)[0]
  if (liveSessionTabsStore.getState().tabs.length === 0 && next) {
    openLiveSessionView(next.id)
    return
  }
  store.openAgentSessionTabs()
}

function focusLiveSessionView(sessionId: string, target: LiveSessionFocusTarget): void {
  const id = liveSessionRegistryStore.currentId(sessionId)
  const { tabs } = liveSessionTabsStore.getState()
  openLiveSessionView(id, tabs.includes(id) ? 'tab' : 'preview')
  liveSessionTabsStore.focus(id, target)
}

/** `claude --resume <id>` or `codex resume <id>`, from the session's folder, for its machine's shell. */
export function liveSessionResumeCommand(session: LiveSession): string {
  const local = session.machine.kind === 'local'
  // Sessions under an account folder resume only with that folder as CODEX_HOME.
  const codexHome =
    session.provider === 'codex' && session.configDir && !/\/\.codex\/?$/.test(session.configDir)
      ? session.configDir
      : null
  return buildAiVaultResumeCommand({
    agent: session.provider,
    sessionId: session.providerSessionId,
    cwd: session.cwd,
    // Remote machines are reached over a POSIX shell.
    platform: local && navigator.userAgent.includes('Windows') ? 'win32' : 'linux',
    codexHome
  })
}

async function copyText(text: string, what: 'session-id' | 'resume-command'): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(text)
    toast.success(
      what === 'session-id'
        ? translate('auto.components.live-sessions.menu.copiedId', 'Session id copied')
        : translate('auto.components.live-sessions.menu.copiedResume', 'Resume command copied')
    )
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}

async function revealTranscript(session: LiveSession): Promise<void> {
  const path = session.transcriptPath
  if (!path) {
    return
  }
  if (session.machine.kind !== 'local') {
    // Another machine's files can't open in this one's file manager; its path is the next best thing.
    await window.api.ui.writeClipboardText(path)
    toast.message(
      translate(
        'auto.components.live-sessions.menu.transcriptRemote',
        'The transcript is on {{host}}. Its path was copied.',
        { host: session.machine.label }
      )
    )
    return
  }
  const result = await window.api.shell.openInFileManager(path, LOCAL_EXECUTION_HOST_ID)
  if (!result.ok) {
    toast.error(
      translate(
        'auto.components.live-sessions.menu.transcriptMissing',
        'Could not show the transcript file. It may have been moved or deleted.'
      )
    )
  }
}

function openMachine(session: LiveSession): void {
  const machineId = parseMachineId(liveSessionMachineId(session.machine))
  if (machineId) {
    rememberMachineSelection(machineId)
  }
  useAppStore.getState().openMachinesPage()
}

/** The one implementation every session menu, shortcut and palette entry runs. */
export const liveSessionMenuEffects: LiveSessionMenuEffects = {
  open: openLiveSessionView,
  focus: focusLiveSessionView,
  askRename: (session) => liveSessionDialogStore.show({ kind: 'rename', session }),
  askMessage: (session) => liveSessionDialogStore.show({ kind: 'message', session }),
  setPinned: (session, pinned) =>
    void window.api.liveSessions.annotate({ sessionId: session.id, pinned }),
  copy: (text, what) => void copyText(text, what),
  swapAccount: (session, accountKey) => {
    const assignment = sealAssignmentFor(session)
    if (assignment) {
      void mutateSealHost(
        { kind: 'local' },
        'seal.accounts.swapSession',
        { sessionId: assignment.id, account: accountKey },
        translate('seal.session.error.swap', 'Could not switch this session')
      )
    }
  },
  takeOver: (session) => void takeOverLiveSession(session),
  openWorktree: (worktreeId) => void activateAndRevealWorktree(worktreeId),
  openMachine,
  revealTranscript: (session) => void revealTranscript(session),
  confirm: (danger, sessions) => liveSessionDialogStore.show({ kind: 'danger', danger, sessions })
}
