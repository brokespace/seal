import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store/index'
import type { AppState } from '@/store/types'
import { getIndexedWorktreeMap } from '@/store/slices/worktrees/listing/worktree-catalog-index'
import { selectWorktreesByRepo } from '@/store/workspaces/catalog/workspace-record-fields'
import { getAiVaultResumeWorkspaceExecutionHostId } from '@/lib/agent-session/resume/history/ai-vault-resume-target'
import { buildAiVaultResumeStartupForWorktree } from '@/lib/agent-session/resume/history/ai-vault-resume-command'
import { launchAiVaultSessionAndReveal } from '@/lib/agent-session/resume/history/launch-ai-vault-session-and-reveal'
import {
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import type {
  LiveSession,
  LiveSessionMachine,
  LiveTakeOverResult
} from '../../../../../shared/live-sessions/live-session-types'

export function canTakeOver(session: LiveSession): boolean {
  return session.origin === 'external' && !session.providerSessionId.startsWith('pid-')
}

/** Take-over opens on the transport the machine uses now, SSH or Seal server alike. */
export function liveSessionExecutionHost(machine: LiveSessionMachine): ExecutionHostId {
  const current = machine.executionHostId ? parseExecutionHostId(machine.executionHostId) : null
  if (current) {
    return current.id
  }
  return machine.kind === 'remote' ? toSshExecutionHostId(machine.hostId) : LOCAL_EXECUTION_HOST_ID
}

/** The workspace the session's folder belongs to on its host, else the active one there. */
export function takeOverWorktreeId(
  state: AppState,
  machine: LiveSessionMachine,
  cwd: string | null
): string | null {
  const host = liveSessionExecutionHost(machine)
  const onHost = [...getIndexedWorktreeMap(selectWorktreesByRepo(state) ?? {}).values()].filter(
    (worktree) => getAiVaultResumeWorkspaceExecutionHostId(state, worktree.id) === host
  )
  const containing = cwd
    ? onHost
        .filter((worktree) => cwd === worktree.path || cwd.startsWith(`${worktree.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0]
    : undefined
  const active =
    state.activeWorktreeId &&
    getAiVaultResumeWorkspaceExecutionHostId(state, state.activeWorktreeId) === host
      ? state.activeWorktreeId
      : null
  return containing?.id ?? active ?? onHost[0]?.id ?? null
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
  if (!takeOverWorktreeId(before, session.machine, session.cwd)) {
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
  const worktreeId = takeOverWorktreeId(state, result.machine, result.cwd)
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
