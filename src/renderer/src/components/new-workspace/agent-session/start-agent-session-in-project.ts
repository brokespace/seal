import { toast } from 'sonner'
import { useAppStore } from '@/store/index'
import { translate } from '@/i18n/i18n'
import { launchAgentInNewTabWithOutcome } from '@/lib/agent-session/launch/new-tab/launch-agent-in-new-tab'
import { captureAgentTabLaunchContext } from '@/components/agent-tab-launch-context'
import { activateAndRevealWorktreeWithOutcome } from '@/lib/workspace/activation/worktree-activation'
import {
  reportAgentWorkspaceActivation,
  type WorkspaceActivationOutcome
} from '@/lib/workspace/activation/worktree-activation-outcome'
import { focusTerminalTabSurface } from '@/components/terminal-pane/input/focus/focus-terminal-tab-surface'
import type { AgentLaunchChoice } from '@/lib/agent-session/launch/routing/agent-menu-selection'
import { createNonSecureContextUuid } from '../../../../../shared/non-secure-context-uuid'
import {
  agentPickerFreshLaunchInputs,
  type AgentPickerDraft,
  type AgentPickerEntry
} from '../../../../../shared/agent-launch/picker/agent-launch-picker'
import type { ExecutionHostId } from '../../../../../shared/execution-host'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import type { Worktree } from '../../../../../shared/worktree/types'

export type ProjectAgentSessionRequest = {
  repoId: string
  executionHostId: ExecutionHostId | null
  /** Null opens a blank terminal in the project. */
  agent: TuiAgent | null
  choice?: AgentLaunchChoice
  draft?: AgentPickerDraft
  entry?: AgentPickerEntry
}

/** The project's own checkout on the chosen machine: its primary worktree, never a linked one. */
function findProjectCheckout(
  repoId: string,
  executionHostId: ExecutionHostId | null
): Worktree | null {
  const candidates = useAppStore
    .getState()
    .allWorktrees()
    .filter(
      (entry) =>
        entry.repoId === repoId &&
        !entry.isArchived &&
        (!executionHostId || !entry.hostId || entry.hostId === executionHostId)
    )
  return candidates.find((entry) => entry.isMainWorktree) ?? null
}

/** Starts the agent in the project's directory without creating a worktree; failures are shown here. */
export async function startAgentSessionInProject(
  request: ProjectAgentSessionRequest
): Promise<boolean> {
  const { repoId, executionHostId, agent, choice, draft, entry } = request
  let checkout = findProjectCheckout(repoId, executionHostId)
  if (!checkout) {
    // The sidebar loads worktrees lazily; a project never expanded this session has none yet.
    await useAppStore
      .getState()
      .fetchWorktrees(repoId)
      .catch(() => false)
    checkout = findProjectCheckout(repoId, executionHostId)
  }
  if (!checkout) {
    toast.error(
      translate(
        'components.newAgentSession.noProjectCheckout',
        'Seal could not find this project’s directory on that machine. Turn on Create worktree, or check that the machine is connected.'
      )
    )
    return false
  }
  const worktreeId = checkout.id
  const reveal = (): WorkspaceActivationOutcome =>
    activateAndRevealWorktreeWithOutcome(worktreeId, {
      ...(executionHostId ? { executionHostId } : {}),
      ...(agent ? { agent, providesInitialSurface: true } : {}),
      sidebarRevealBehavior: 'auto'
    })
  if (!agent) {
    const revealed = reveal()
    if (!('opened' in revealed)) {
      if (!revealed.refused.failureNotified) {
        toast.error(
          translate(
            'components.newAgentSession.openProjectFailed',
            'Seal could not open this project’s directory.'
          )
        )
      }
      return false
    }
    focusTerminalTabSurface(useAppStore.getState().createTab(worktreeId).id)
    return true
  }
  const outcome = launchAgentInNewTabWithOutcome({
    requestId: createNonSecureContextUuid(),
    ...captureAgentTabLaunchContext(worktreeId),
    agent,
    worktreeId,
    ...(executionHostId ? { workspaceExecutionHostId: executionHostId } : {}),
    ...(choice?.requestedSurface
      ? {
          requestedSurface: choice.requestedSurface,
          selectedExecutionHostId: choice.executionHostId
        }
      : {}),
    ...(draft
      ? agentPickerFreshLaunchInputs(
          draft,
          {
            surface: choice?.requestedSurface ?? draft.surface,
            executionHostId: choice?.executionHostId
          },
          entry
        )
      : {}),
    launchSource: 'sidebar',
    beforeSurfaceOpen: () => reportAgentWorkspaceActivation(reveal(), agent)
  })
  // A refused launch already told the user why.
  if (!outcome || 'refused' in outcome) {
    return false
  }
  if (outcome.surface.kind === 'local-terminal') {
    focusTerminalTabSurface(outcome.surface.tabId)
  }
  return true
}
