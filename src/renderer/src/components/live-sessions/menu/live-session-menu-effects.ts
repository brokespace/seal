import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { isAiVaultAgent } from '../../../../../shared/ai-vault/contracts/ai-vault-types'
import {
  buildAiVaultResumeCommand,
  buildAiVaultResumeShellCommand
} from '../../../../../shared/ai-vault/resume/ai-vault-resume-command'
import { agentSessionAdapter } from '../../../../../shared/live-sessions/adapters/agent-session-adapters'
import { isProvisionalLiveSessionId } from '../../../../../shared/live-sessions/live-session-provisional-id'
import {
  quoteCmdDoubleQuoted,
  quotePosixShellUnlessPlain
} from '../../../../../shared/shell/launch/shell-argument-quoting'
import { liveSessionMachineId } from '../../../../../shared/live-sessions/live-session-machine-id'
import { liveSessionExecutionHost } from '../../../../../shared/live-sessions/live-session-execution-host'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { parseMachineId } from '../../../../../shared/machines/machine-types'
import { rememberMachineSelection } from '../../machines/model/machine-selection'
import { mutateSealHost } from '../../seal-session/seal-session-status-store'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { takeOverLiveSession } from '../take-over/live-session-take-over'
import {
  requestAgentSessionFocus,
  type AgentSessionFocusTarget
} from '../chat/agent-session-focus-requests'
import type { AgentSessionOpenMode } from '../open/agent-session-open-mode'
import { openAgentSession } from '../open/open-agent-session'
import { liveSessionDialogStore } from './live-session-dialog-store'
import type { LiveSessionMenuEffects } from './live-session-menu'
import { sealAssignmentFor } from './live-session-accounts'

/** How a session's row opens it, on any surface: a click previews, a double click or Enter keeps the tab. */
export function liveSessionRowOpenMode(event?: { type: string }): AgentSessionOpenMode {
  return event?.type === 'dblclick' || event?.type === 'keydown' ? 'tab' : 'preview'
}

function focusAgentSession(sessionId: string, target: AgentSessionFocusTarget): void {
  const id = liveSessionRegistryStore.currentId(sessionId)
  openAgentSession(id)
  requestAgentSessionFocus(id, target)
}

/** `claude --resume <id>` or `codex resume <id>`, from the session's folder, for its machine's shell. */
export function liveSessionResumeCommand(session: LiveSession): string {
  const local = session.machine.kind === 'local'
  // Remote machines are reached over a POSIX shell.
  const platform = local && navigator.userAgent.includes('Windows') ? 'win32' : 'linux'
  if (!isAiVaultAgent(session.provider)) {
    // An agent Session History cannot resume: its adapter says how, or that it cannot.
    const argv = agentSessionAdapter(session.provider)?.cli?.resumeArgv?.(
      session.providerSessionId,
      session.transcriptPath
    )
    return argv && !isProvisionalLiveSessionId(session.providerSessionId)
      ? buildAiVaultResumeShellCommand({
          resumeCommand: argv
            .map(platform === 'win32' ? quoteCmdDoubleQuoted : quotePosixShellUnlessPlain)
            .join(' '),
          cwd: session.cwd,
          platform
        })
      : ''
  }
  // Sessions under an account folder resume only with that folder as CODEX_HOME.
  const codexHome =
    session.provider === 'codex' && session.configDir && !/\/\.codex\/?$/.test(session.configDir)
      ? session.configDir
      : null
  return buildAiVaultResumeCommand({
    agent: session.provider,
    sessionId: session.providerSessionId,
    cwd: session.cwd,
    platform,
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
  open: openAgentSession,
  focus: focusAgentSession,
  askRename: (session) => liveSessionDialogStore.show({ kind: 'rename', session }),
  askMessage: (session) => liveSessionDialogStore.show({ kind: 'message', session }),
  setPinned: (session, pinned) =>
    void window.api.liveSessions.annotate({ sessionId: session.id, pinned }),
  moveToProject: (session, project) =>
    void window.api.liveSessions.annotate({ sessionId: session.id, project }),
  askNewProject: (session) => liveSessionDialogStore.show({ kind: 'project', session }),
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
  openWorktree: (worktreeId, session) => {
    // A same-id workspace on several machines opens the session's own copy, so Files shows its files.
    const hostId = liveSessionExecutionHost(session.machine)
    const onSessionHost = useAppStore.getState().getKnownWorktreeById(worktreeId, hostId)
    void activateAndRevealWorktree(
      worktreeId,
      onSessionHost ? { executionHostId: hostId } : undefined
    )
  },
  openMachine,
  revealTranscript: (session) => void revealTranscript(session),
  confirm: (danger, sessions) => liveSessionDialogStore.show({ kind: 'danger', danger, sessions })
}
