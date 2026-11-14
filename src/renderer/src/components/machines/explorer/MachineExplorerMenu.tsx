import React from 'react'
import { useTranslate } from '@/i18n/use-translate'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import type { ExplorerRow } from './machine-explorer-rows'
import type { MachineFileActions } from './use-machine-file-actions'

type EntryRow = Extract<ExplorerRow, { type: 'entry' }>

export function MachineExplorerMenu({
  menuRow,
  menuDir,
  selectedPaths,
  machineKind,
  onOpen,
  editorLabel,
  onOpenInEditor,
  actions
}: {
  menuRow: EntryRow | null
  menuDir: string | null
  selectedPaths: string[]
  machineKind: MachineSummary['connection']
  onOpen: (row: EntryRow) => void
  editorLabel: string
  onOpenInEditor: (row: EntryRow) => void
  actions: MachineFileActions
}): React.JSX.Element {
  const t = useTranslate()
  const isRemote = machineKind !== 'local'
  return (
    <ContextMenuContent className="min-w-44">
      {menuRow ? (
        <ContextMenuItem onSelect={() => onOpen(menuRow)}>
          {menuRow.entry.isDirectoryLike
            ? t('auto.components.machines.menu.openFolder', 'Open folder')
            : t('auto.components.machines.menu.preview', 'Preview')}
        </ContextMenuItem>
      ) : null}
      {menuRow ? (
        <ContextMenuItem onSelect={() => onOpenInEditor(menuRow)}>{editorLabel}</ContextMenuItem>
      ) : null}
      {menuRow ? (
        <ContextMenuItem onSelect={() => actions.download(selectedPaths)}>
          {t('auto.components.machines.menu.download', 'Download to this computer…')}
        </ContextMenuItem>
      ) : null}
      {menuRow ? (
        <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(menuRow.path)}>
          {t('auto.components.machines.menu.copyPath', 'Copy path')}
        </ContextMenuItem>
      ) : null}
      {menuDir ? (
        <>
          {menuRow ? <ContextMenuSeparator /> : null}
          <ContextMenuItem onSelect={() => actions.newFolder(menuDir)}>
            {t('auto.components.machines.menu.newFolder', 'New folder…')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => actions.pickAndUpload(menuDir)}>
            {t('auto.components.machines.menu.upload', 'Upload files…')}
          </ContextMenuItem>
          {isRemote ? (
            <ContextMenuItem onSelect={() => actions.downloadUrl(menuDir)}>
              {t('auto.components.machines.menu.downloadUrl', 'Download from URL…')}
            </ContextMenuItem>
          ) : null}
        </>
      ) : null}
      {menuRow ? (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={selectedPaths.length !== 1}
            onSelect={() => actions.rename(menuRow.path)}
          >
            {t('auto.components.machines.menu.rename', 'Rename…')}
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onSelect={() => actions.requestDelete(selectedPaths)}
          >
            {t('auto.components.machines.menu.delete', 'Delete…')}
          </ContextMenuItem>
        </>
      ) : null}
    </ContextMenuContent>
  )
}
