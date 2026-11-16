import React from 'react'
import { Merge } from 'lucide-react'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import type { Repo } from '../../../../shared/repo-types'
import { getProjectMergeSource, getProjectMergeTargets, mergeProjectInto } from './project-merge'

/** "Merge into project" for a path-identified project; nothing where no merge is possible. */
export function ProjectMergeMenuItem({
  repo,
  label
}: {
  repo: Repo
  label: string
}): React.JSX.Element | null {
  const t = useTranslate()
  const confirm = useConfirmationDialog()
  const projects = useAppStore((state) => state.projects)
  const setups = useAppStore((state) => state.projectHostSetups)
  const source = getProjectMergeSource(repo, setups)
  const targets = source ? getProjectMergeTargets(projects) : []
  if (!source || targets.length === 0) {
    return null
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Merge className="size-3.5" />
        {t('seal.projectMerge.action', 'Merge into project')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            onSelect={() => void mergeProjectInto({ source, sourceLabel: label, target, confirm })}
          >
            <span className="max-w-48 truncate">{target.displayName}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
