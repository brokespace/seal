import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate as t } from '@/i18n/i18n'
import { rememberMachineSelection } from '@/components/machines/model/machine-selection'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

export function openProjectWorkspace(worktree: Worktree): void {
  activateAndRevealWorktree(
    worktree.id,
    worktree.hostId ? { executionHostId: worktree.hostId } : undefined
  )
}

/** The project's pane in Settings, at one of its sections when given. */
export function openProjectSettings(repo: Repo, sectionId?: string): void {
  const state = useAppStore.getState()
  state.openSettingsTarget({ pane: 'repo', repoId: repo.id, ...(sectionId ? { sectionId } : {}) })
  state.openSettingsPage()
}

export function openProjectMachine(machine: MachineSummary): void {
  rememberMachineSelection(machine.id)
  useAppStore.getState().openMachinesPage()
}

export async function copyProjectPath(path: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(path)
    toast.success(t('seal.projectOverview.pathCopied', 'Path copied'))
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error))
  }
}
