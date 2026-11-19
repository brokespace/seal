import React from 'react'
import { Bookmark } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store'
import { getRepoExecutionHostId } from '../../../../../../shared/execution-host'
import type { Repo } from '../../../../../../shared/repo-types'

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
  if (!results.every(Boolean)) {
    toast.error(
      translate('seal.autoProjects.makePermanentFailed', "Couldn't make {{name}} permanent.", {
        name
      })
    )
  }
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
