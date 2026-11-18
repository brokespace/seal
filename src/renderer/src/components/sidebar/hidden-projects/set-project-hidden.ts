import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import type { Repo } from '../../../../../shared/repo-types'
import { repoMatchesHostIdentity } from '@/store/repos/repo-host-identity'
import { projectGroupMatchesOwnerHost } from '@/store/project-groups/project-group-owner-routing'

type HiddenTarget = { id: string; connectionId?: string | null; executionHostId?: string | null }

/** How one kind of project row is read and written: a repo's host copies, or a project group. */
type HiddenRows = {
  /** The row as the store has it now; undefined once removed. */
  current: (target: HiddenTarget) => { hiddenAt?: number } | undefined
  write: (target: HiddenTarget, hiddenAt: number | null) => Promise<boolean>
}

const REPO_ROWS: HiddenRows = {
  current: (target) =>
    useAppStore
      .getState()
      .repos.find((repo) =>
        repoMatchesHostIdentity(repo, target.id, getRepoExecutionHostId(target))
      ),
  write: (target, hiddenAt) =>
    useAppStore
      .getState()
      .updateRepo(target.id, { hiddenAt }, { hostId: getRepoExecutionHostId(target) })
}

const GROUP_ROWS: HiddenRows = {
  current: (target) =>
    useAppStore
      .getState()
      .projectGroups.find((group) =>
        projectGroupMatchesOwnerHost(group, target.id, getRepoExecutionHostId(target))
      ),
  write: (target, hiddenAt) =>
    useAppStore
      .getState()
      .updateProjectGroup(target.id, { hiddenAt }, { hostId: getRepoExecutionHostId(target) })
}

async function writeHidden(
  rows: HiddenRows,
  targets: readonly HiddenTarget[],
  hiddenAt: number | null
): Promise<HiddenTarget[]> {
  const results = await Promise.all(targets.map((target) => rows.write(target, hiddenAt)))
  return targets.filter((_, index) => results[index])
}

/** Undoes only this toast's hide: a copy shown since, or hidden again by a newer hide, is left alone. */
async function undoHide(
  rows: HiddenRows,
  targets: readonly HiddenTarget[],
  hiddenAt: number,
  name: string
): Promise<void> {
  const current = targets.map(rows.current)
  // Removed meanwhile: nothing is left to show, which is not a failure.
  if (current.every((row) => row === undefined)) {
    toast.info(
      translate('sidebar.hiddenProjects.undoGone', '{{name}} was removed from Orca.', { name })
    )
    return
  }
  const present = targets.filter((_, index) => current[index]?.hiddenAt === hiddenAt)
  if ((await writeHidden(rows, present, null)).length < present.length) {
    toast.error(
      translate('sidebar.hiddenProjects.showFailed', "Couldn't show {{name}} again.", { name })
    )
  }
}

async function setHidden(
  rows: HiddenRows,
  targets: readonly HiddenTarget[],
  hidden: boolean,
  name: string
): Promise<boolean> {
  const hiddenAt = hidden ? Date.now() : null
  const written = await writeHidden(rows, targets, hiddenAt)
  if (written.length < targets.length) {
    toast.error(
      hidden
        ? translate(
            'sidebar.hiddenProjects.hideFailed',
            "Couldn't hide {{name}}. Its host may need an Orca update.",
            { name }
          )
        : translate('sidebar.hiddenProjects.showFailed', "Couldn't show {{name}} again.", { name })
    )
  }
  if (hiddenAt !== null && written.length > 0) {
    toast.success(translate('sidebar.hiddenProjects.hidden', '{{name}} hidden', { name }), {
      description: translate(
        'sidebar.hiddenProjects.hiddenDescription',
        'Its terminals and agents keep running. Show it again from Hidden projects below the list.'
      ),
      action: {
        label: translate('sidebar.hiddenProjects.undo', 'Undo'),
        onClick: () => void undoHide(rows, written, hiddenAt, name)
      }
    })
  }
  return written.length === targets.length
}

/**
 * Hides or shows the given host copies of one project in the sidebar; terminals and agents keep
 * running. A header spanning hosts passes every copy it shows, so one action and one Undo cover all.
 */
export function setProjectHidden(
  targets: readonly Pick<Repo, 'id' | 'connectionId' | 'executionHostId'>[],
  hidden: boolean,
  name: string
): Promise<boolean> {
  return setHidden(REPO_ROWS, targets, hidden, name)
}

/** The same for a project group's header; its sessions list with no project while it is hidden. */
export function setProjectGroupHidden(
  group: Pick<ProjectGroup, 'id' | 'connectionId' | 'executionHostId'>,
  hidden: boolean,
  name: string
): Promise<boolean> {
  return setHidden(GROUP_ROWS, [group], hidden, name)
}
