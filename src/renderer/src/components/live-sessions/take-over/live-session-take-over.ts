import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/agent-session/resume/history/ai-vault-resume-target'
import { buildAiVaultResumeStartupForWorktree } from '@/lib/agent-session/resume/history/ai-vault-resume-command'
import { launchAiVaultSessionAndReveal } from '@/lib/agent-session/resume/history/launch-ai-vault-session-and-reveal'
import { liveSessionExecutionHost } from '../../../../../shared/live-sessions/live-session-execution-host'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveTakeOverResult
} from '../../../../../shared/live-sessions/live-session-types'
import { liveSessionRegistryStore } from '../live-session-registry-store'
import { workspaceLinkFinder } from '../links/live-session-links'

export function canTakeOver(session: LiveSession): boolean {
  return session.origin === 'external' && !session.providerSessionId.startsWith('pid-')
}

/** The session's workspace when this window lists it, else the active one on its host, else any there. */
function takeOverWorktreeId(
  state: AppState,
  session: LiveSession,
  machine: LiveSessionMachine
): string | null {
  const id = liveSessionRegistryStore.currentId(session.id)
  // A take-over result names no workspace; the registry's copy is newer than the caller's.
  const workspace =
    liveSessionRegistryStore.getState().sessions.find((current) => current.id === id)?.workspace ??
    session.workspace
  const own = workspace && workspaceLinkFinder(state)(workspace.worktreeId)
  if (own) {
    return own.worktreeId
  }
  const host = liveSessionExecutionHost(machine)
  const onHost = (worktreeId: string): boolean =>
    getAiVaultResumeWorkspaceExecutionHostId(state, worktreeId) === host
  if (state.activeWorktreeId && onHost(state.activeWorktreeId)) {
    return state.activeWorktreeId
  }
  return [...getIndexedWorktreeMap(selectWorktreesByRepo(state) ?? {}).keys()].find(onHost) ?? null
}

function failureText(result: Extract<LiveTakeOverResult, { ok: false }>): string {
  switch (result.reason) {
    case 'not_found':
      return translate(
        'auto.components.live-sessions.takeOver.notFound',
        'That session is no longer listed.'
      )
    case 'not_external':
      return translate(
        'auto.components.live-sessions.takeOver.notExternal',
        'This session already runs in a Seal pane.'
      )
    case 'not_resumable':
      return translate(
        'auto.components.live-sessions.takeOver.notResumable',
        'Seal hasn’t seen this session’s transcript yet, so it can’t resume it. Send it a first message, then try again.'
      )
    case 'still_running':
      return translate(
        'auto.components.live-sessions.takeOver.stillRunning',
        'The agent process didn’t stop.'
      )
    case 'failed':
      return result.error ?? ''
  }
}

/** Stops the external process and resumes its conversation in a new Seal pane. */
export async function takeOverLiveSession(session: LiveSession): Promise<boolean> {
  const before = useAppStore.getState()
  if (!takeOverWorktreeId(before, session, session.machine)) {
    toast.error(
      translate(
        'auto.components.live-sessions.takeOver.noWorkspace',
        'Open a workspace on {{host}} first; the session reopens in a pane there.',
        { host: session.machine.label }
      )
    )
    return false
  }
  const result = await window.api.liveSessions.takeOver({ sessionId: session.id })
  if (!result.ok) {
    toast.error(
      translate(
        'auto.components.live-sessions.takeOver.failed',
        'Could not take over the session. {{reason}}',
        { reason: failureText(result) }
      )
    )
    return false
  }
  const state = useAppStore.getState()
  const worktreeId = takeOverWorktreeId(state, session, result.machine)
  if (!worktreeId) {
    return false
  }
  const startup = buildAiVaultResumeStartupForWorktree({
    state,
    worktreeId,
    session: {
      agent: result.provider,
      sessionId: result.providerSessionId,
      cwd: result.cwd,
      codexHome: result.codexHome,
      executionHostId: liveSessionExecutionHost(result.machine),
      filePath: result.transcriptPath ?? undefined
    },
    commandOverride: state.settings?.agentCmdOverrides?.[result.provider]
  })
  return (
    (await launchAiVaultSessionAndReveal({ agent: result.provider, worktreeId, ...startup })) !==
    null
  )
}
