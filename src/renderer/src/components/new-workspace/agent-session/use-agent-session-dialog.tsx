import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { getAgentCatalog } from '@/lib/agent-catalog/agent-catalog'
import type { NewWorkspaceComposerCardProps } from '../composer/new-workspace-composer-card-props'
import type { TuiAgent } from '../../../../../shared/agent-launch/catalog/tui-agent'
import { normalizeExecutionHostId } from '../../../../../shared/execution-host'
import { AgentSessionAccountField } from './AgentSessionAccountField'
import {
  chooseAgentSessionAccount,
  currentAgentSessionAccount,
  type AgentSessionAccountChoice
} from './agent-session-account-choice'
import { saveLastSessionAgent } from './last-session-agent-preference'
import {
  startAgentSessionInProject,
  type ProjectAgentSessionRequest
} from './start-agent-session-in-project'

type SessionTarget = Pick<
  NewWorkspaceComposerCardProps,
  | 'repoId'
  | 'selectedRepoIsGit'
  | 'projectOptions'
  | 'selectedProjectId'
  | 'selectedRepoExecutionHostId'
  | 'selectedRepoRequiresConnection'
  | 'selectedEphemeralVmRecipeId'
  | 'advancedOpen'
  | 'onToggleAdvanced'
  | 'creating'
>

export type AgentSessionDialog = {
  enabled: boolean
  /** The account this start runs on, when one was chosen for this agent and machine. */
  account: AgentSessionAccountChoice | null
  /** The agent starts in the project's own directory; nothing is created. */
  startsInProject: boolean
  projectStartDisabled: boolean
  cardProps: Partial<
    Pick<NewWorkspaceComposerCardProps, 'agentSession' | 'creating' | 'showCreateMultiple'>
  >
  /** Applies the session's choices; `create-worktree` hands the start to the worktree create. */
  prepareStart: (
    launch: Pick<ProjectAgentSessionRequest, 'choice' | 'draft' | 'entry'>
  ) => Promise<'create-worktree' | 'started' | 'stopped'>
}

async function whileStarting<T>(
  setStarting: (starting: boolean) => void,
  work: () => Promise<T>
): Promise<T> {
  setStarting(true)
  try {
    return await work()
  } finally {
    setStarting(false)
  }
}

/** The New agent session dialog's own state on top of the workspace composer it extends. */
export function useAgentSessionDialog({
  enabled,
  agent,
  cardProps,
  executionHostId
}: {
  enabled: boolean
  agent: TuiAgent | null
  cardProps: SessionTarget
  executionHostId: string | undefined
}): AgentSessionDialog {
  const [worktreeRequested, setWorktreeRequested] = useState(false)
  const [accountChoice, setAccountChoice] = useState<AgentSessionAccountChoice | null>(null)
  const [starting, setStarting] = useState(false)

  const hostId = normalizeExecutionHostId(executionHostId ?? cardProps.selectedRepoExecutionHostId)
  const selectedProject = cardProps.projectOptions?.find(
    (option) => option.id === cardProps.selectedProjectId
  )
  // Folder workspaces and not-yet-provisioned VMs have no existing checkout to start in.
  const worktreeOptional =
    cardProps.selectedRepoIsGit &&
    selectedProject?.kind !== 'project-group' &&
    !cardProps.selectedEphemeralVmRecipeId
  const createWorktree = !worktreeOptional || worktreeRequested
  const account = enabled ? currentAgentSessionAccount(accountChoice, agent, hostId) : null
  const { repoId, advancedOpen, onToggleAdvanced } = cardProps

  const handleCreateWorktreeChange = useCallback(
    (next: boolean) => {
      setWorktreeRequested(next)
      // Turning it on shows every worktree option, including the ones kept under Advanced.
      if (next && !advancedOpen) {
        onToggleAdvanced()
      }
    },
    [advancedOpen, onToggleAdvanced]
  )

  const prepareStart = useCallback<AgentSessionDialog['prepareStart']>(
    async (launch) => {
      if (!enabled) {
        return 'create-worktree'
      }
      saveLastSessionAgent(agent)
      if (account && repoId) {
        try {
          await chooseAgentSessionAccount(account, repoId)
        } catch (caught) {
          toast.error(
            translate(
              'components.newAgentSession.accountChoiceFailed',
              'Could not start on the chosen account'
            ),
            { description: caught instanceof Error ? caught.message : String(caught) }
          )
          return 'stopped'
        }
      }
      if (createWorktree) {
        return 'create-worktree'
      }
      const started = await whileStarting(setStarting, () =>
        startAgentSessionInProject({ repoId, executionHostId: hostId, agent, ...launch })
      )
      return started ? 'started' : 'stopped'
    },
    [account, agent, createWorktree, enabled, hostId, repoId]
  )

  if (!enabled) {
    return {
      enabled,
      account: null,
      startsInProject: false,
      projectStartDisabled: false,
      cardProps: {},
      prepareStart
    }
  }
  return {
    enabled,
    account,
    startsInProject: !createWorktree,
    projectStartDisabled: starting || !repoId || cardProps.selectedRepoRequiresConnection,
    prepareStart,
    cardProps: {
      creating: cardProps.creating || starting,
      // Create more repeats a worktree create; a start in the project has nothing to repeat.
      ...(createWorktree ? {} : { showCreateMultiple: false }),
      agentSession: {
        createWorktree,
        ...(worktreeOptional ? { onCreateWorktreeChange: handleCreateWorktreeChange } : {}),
        accountField: (
          <AgentSessionAccountField
            agent={agent}
            agentLabel={getAgentCatalog().find((entry) => entry.id === agent)?.label ?? null}
            executionHostId={hostId}
            value={account}
            onChange={setAccountChoice}
          />
        )
      }
    }
  }
}
