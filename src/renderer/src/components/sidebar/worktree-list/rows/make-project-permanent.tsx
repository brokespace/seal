import React from 'react'
import { Bookmark } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'

function reportFailure(done: boolean, name: string): void {
  if (!done) {
    toast.error(
      translate('seal.autoProjects.makePermanentFailed', "Couldn't make {{name}} permanent.", {
        name
      })
    )
  }
}

/** Keeps a project Seal made for agents once none is left: each host copy loses its mark. */
export async function makeReposPermanent(repos: readonly Repo[], name: string): Promise<void> {
  const { updateRepo } = useAppStore.getState()
  const results = await Promise.all(
    repos
      .filter((repo) => repo.autoCreated)
      .map((repo) =>
        updateRepo(repo.id, { autoCreated: null }, { hostId: getRepoExecutionHostId(repo) })
      )
  )
  reportFailure(results.every(Boolean), name)
}

/** Keeps a project Seal made for sessions once none is left. */
export async function makeProjectGroupPermanent(group: ProjectGroup, name: string): Promise<void> {
  const done = await useAppStore
    .getState()
    .updateProjectGroup(group.id, { keptAt: Date.now() }, { hostId: getRepoExecutionHostId(group) })
  reportFailure(done, name)
}

export function MakePermanentMenuItem({ onSelect }: { onSelect: () => void }): React.JSX.Element {
  const t = useTranslate()
  return (
    <DropdownMenuItem onSelect={onSelect}>
      <Bookmark className="size-3.5" />
      {t('seal.autoProjects.makePermanent', 'Make Permanent')}
    </DropdownMenuItem>
  )
}
