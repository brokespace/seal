import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { ConfirmationDialogContextValue } from '@/components/confirmation-dialog-context'
import { parseExecutionHostId } from '../../../../shared/execution-host'
import { getProjectHostSetupForRepo } from '../../../../shared/project-host-setup-lookup'
import {
  getProjectIdForProviderIdentity,
  isHostLocalProjectId
} from '../../../../shared/project-host-setup-projection'
import type { Project, ProjectHostSetup } from '../../../../shared/project-types'
import type { Repo } from '../../../../shared/repo-types'

/** The path-identified project `repo` belongs to, with every checkout that must be relinked. */
export function getProjectMergeSource(
  repo: Repo,
  setups: readonly ProjectHostSetup[]
): readonly ProjectHostSetup[] | null {
  const projectId = getProjectHostSetupForRepo(setups, repo).projectId
  if (!isHostLocalProjectId(projectId)) {
    return null
  }
  const source = setups.filter((setup) => setup.projectId === projectId && setup.repoId)
  // No process relinks a checkout on an SSH host that runs no server.
  const relinkable = source.every((setup) => parseExecutionHostId(setup.hostId)?.kind !== 'ssh')
  return source.length > 0 && relinkable ? source : null
}

/** Only a GitHub identity can be stamped onto a checkout that names no remote of its own. */
export function getProjectMergeTargets(projects: readonly Project[]): Project[] {
  return projects.filter(
    (project) =>
      project.providerIdentity &&
      getProjectIdForProviderIdentity(project.providerIdentity) === project.id
  )
}

/** A checkout whose relink fails stays in its own project; the store action toasts the reason. */
export async function mergeProjectInto(args: {
  source: readonly ProjectHostSetup[]
  sourceLabel: string
  target: Project
  confirm: ConfirmationDialogContextValue
}): Promise<void> {
  const names = { source: args.sourceLabel, target: args.target.displayName }
  const confirmed = await args.confirm({
    title: translate('seal.projectMerge.confirmTitle', 'Merge {{source}} into {{target}}?', names),
    description: translate(
      'seal.projectMerge.confirmDescription',
      "Its workspaces, sessions and pins move to {{target}}. This can't be undone.",
      names
    ),
    confirmLabel: translate('seal.projectMerge.confirm', 'Merge')
  })
  if (!confirmed) {
    return
  }
  for (const setup of args.source) {
    await useAppStore.getState().setupProjectExistingFolder({
      projectId: args.target.id,
      hostId: setup.hostId,
      path: setup.path,
      kind: setup.kind
    })
  }
}
