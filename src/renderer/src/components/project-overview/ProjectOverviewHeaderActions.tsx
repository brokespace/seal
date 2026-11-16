import { Copy, Ellipsis, FolderOpen, Plus, SlidersHorizontal, SquareTerminal } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/class-names'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useRepoSshGate } from '@/hooks/use-repo-ssh-gate'
import {
  getRevealInFileManagerLabel,
  revealInFileManager
} from '@/lib/files/os-open/reveal-in-file-manager'
import { openMachineTerminal } from '@/components/machines/detail/machine-quick-actions'
import {
  MachineEditorButton,
  type MachineEditorChoice
} from '@/components/machines/editor/MachineEditorButton'
import { openMachinePathInEditor } from '@/components/machines/editor/machine-editor-open'
import { openHeaderCreateComposer } from '@/components/sidebar/worktree-list/rows/header-create-workspace-target'
import { getRepoHeaderCreateState } from '@/components/sidebar/worktree-list/rows/repo-header-create-state'
import { getRepoExecutionHostId } from '../../../../shared/execution-host/execution-host'
import type { MachineSummary } from '../../../../shared/machines/machine-summaries'
import type { Repo } from '../../../../shared/repository/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  copyProjectPath,
  openProjectMachine,
  openProjectSettings,
  openProjectWorkspace
} from './project-overview-actions'

/** The page's actions: start an agent here, open the project elsewhere, and its settings. */
export function ProjectOverviewHeaderActions({
  repo,
  machine,
  mainWorktree
}: {
  repo: Repo
  /** Null while the machine list loads, or when the project's machine is no longer known. */
  machine: MachineSummary | null
  mainWorktree: Worktree | null
}): React.JSX.Element {
  const t = useTranslate()
  const sshGate = useRepoSshGate(repo)
  // The sidebar +'s own gate, so the page refuses to start an agent exactly when the sidebar does.
  const createState = getRepoHeaderCreateState({ repo, label: repo.displayName, sshGate }, t)
  const isLocal = machine?.connection === 'local'

  const openInSeal = (): void => {
    if (mainWorktree) {
      openProjectWorkspace(mainWorktree)
    }
  }
  const openInEditor = (choice: MachineEditorChoice): void => {
    if (!machine) {
      return
    }
    if (choice === 'seal') {
      openInSeal()
      return
    }
    void openMachinePathInEditor(
      machine,
      { path: repo.path, kind: 'folder' },
      { openBuiltIn: openInSeal, addSshDetails: () => openProjectMachine(machine) },
      choice.applicationId
    )
  }

  return (
    <div
      className={cn(
        'flex max-w-full shrink-0 flex-wrap items-center gap-2',
        // The editor's label follows the page's width, not the window's: the sidebar takes its share.
        '[&_[data-machine-editor-label]]:hidden @min-[28rem]/project-header:[&_[data-machine-editor-label]]:inline'
      )}
    >
      <span title={createState.disabled ? createState.tooltip : undefined}>
        <Button
          type="button"
          size="sm"
          data-project-overview-new-agent
          disabled={createState.disabled}
          onClick={() => openHeaderCreateComposer(repo, { pinHost: true })}
        >
          <Plus />
          {t('seal.projectOverview.newAgent', 'New agent')}
        </Button>
      </span>
      {machine ? (
        <MachineEditorButton
          machine={machine}
          onOpen={openInEditor}
          onAddSshDetails={() => openProjectMachine(machine)}
        />
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={t('seal.projectOverview.moreActions', 'More project actions')}
          >
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          {mainWorktree ? (
            <DropdownMenuItem onSelect={openInSeal}>
              <SquareTerminal />
              {t('seal.projectOverview.openMainWorkspace', 'Open main workspace')}
            </DropdownMenuItem>
          ) : null}
          {machine && !isLocal ? (
            <DropdownMenuItem
              disabled={machine.status !== 'online'}
              onSelect={() => openMachineTerminal(machine, repo.path)}
            >
              <SquareTerminal />
              {t('seal.projectOverview.openTerminalOn', 'Open terminal on {{machine}}', {
                machine: machine.label
              })}
            </DropdownMenuItem>
          ) : null}
          {isLocal ? (
            <DropdownMenuItem
              onSelect={() => void revealInFileManager(repo.path, getRepoExecutionHostId(repo))}
            >
              <FolderOpen />
              {getRevealInFileManagerLabel(t)}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => void copyProjectPath(repo.path)}>
            <Copy />
            {t('seal.projectOverview.copyPath', 'Copy path')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openProjectSettings(repo)}>
            <SlidersHorizontal />
            {t('seal.projectOverview.projectSettings', 'Project settings')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
