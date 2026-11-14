import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { useTranslate } from '@/i18n/use-translate'
import { NO_OPEN_IN_APPLICATIONS } from '@/lib/files/os-open/open-in-application-selection'
import { machinePathBasename } from '../../../../../shared/machines/machine-paths'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { MachineFileEntry } from '../../../../../shared/machines/machine-types'
import type { ExplorerRow } from '../explorer/machine-explorer-rows'
import type { MachineEditorChoice } from './MachineEditorButton'
import { openMachinePathInEditor, type MachineEditorTarget } from './machine-editor-open'
import { planMachineEditorOpen } from './machine-editor-plan'

type EntryRow = Extract<ExplorerRow, { type: 'entry' }>

/** "Open in editor" for the file browser: its rows, and the folder it is showing. */
export function useMachineExplorerEditor({
  machine,
  root,
  rootError,
  rows,
  onAddSshDetails,
  showFolder,
  showFile
}: {
  machine: MachineSummary
  root: string | null
  rootError: string | null
  rows: readonly ExplorerRow[]
  onAddSshDetails: () => void
  /** Seal's own editor for a folder is the file browser itself. */
  showFolder: (path: string) => void
  showFile: (path: string, entry: MachineFileEntry) => void
}): {
  /** The menu label: names the app the path opens in when there is one. */
  label: string
  openRow: (row: EntryRow) => void
  openCurrentFolder: (choice: MachineEditorChoice) => void
} {
  const t = useTranslate()
  const applications = useAppStore((s) => s.settings?.openInApplications ?? NO_OPEN_IN_APPLICATIONS)
  const plan = planMachineEditorOpen(machine, applications)
  const open = (target: MachineEditorTarget, choice: MachineEditorChoice): void => {
    const openBuiltIn = ({ path, kind }: MachineEditorTarget): void => {
      if (kind === 'folder') {
        showFolder(path)
        return
      }
      const row = rows.find((entry) => entry.type === 'entry' && entry.path === path)
      showFile(
        path,
        row?.type === 'entry'
          ? row.entry
          : {
              name: machinePathBasename(path),
              kind: 'file',
              isDirectoryLike: false,
              size: 0,
              mtimeMs: 0
            }
      )
    }
    if (choice === 'seal') {
      openBuiltIn(target)
      return
    }
    void openMachinePathInEditor(
      machine,
      target,
      { openBuiltIn, addSshDetails: onAddSshDetails },
      choice.applicationId
    )
  }

  const openRow = (row: EntryRow): void =>
    open({ path: row.path, kind: row.entry.isDirectoryLike ? 'folder' : 'file' }, {})

  const openCurrentFolder = (choice: MachineEditorChoice): void => {
    if (root === null) {
      toast.error(
        rootError ??
          t(
            'auto.components.machines.editor.filesLoading',
            'Still loading this machine’s files. Try again in a moment.'
          )
      )
      return
    }
    open({ path: root, kind: 'folder' }, choice)
  }

  return {
    label:
      plan.kind === 'external'
        ? t('auto.components.machines.editor.openInApp', 'Open in {{app}}', {
            app: plan.application.label
          })
        : t('auto.components.machines.detail.editor', 'Open in editor'),
    openRow,
    openCurrentFolder
  }
}
