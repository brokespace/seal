import { useState } from 'react'
import { Copy, Edit3, ImageDown, Share2, Trash2 } from 'lucide-react-native'
import {
  isValidMachineFileName,
  joinMachinePath,
  machinePathDirname
} from '../../../../src/shared/machines/machine-paths'
import { ActionSheetModal, type ActionSheetAction } from '../../components/ActionSheetModal'
import { ConfirmModal } from '../../components/ConfirmModal'
import { TextInputModal } from '../../components/TextInputModal'
import { classifyMobileArtifact } from '../../files/preview/mobile-artifact-kind'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import { useClipboardWriter } from '../../platform/clipboard/clipboard'
import { triggerError, triggerSuccess } from '../../platform/haptics/haptics'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { createMachineDirectory, removeMachinePaths, renameMachinePath } from './machine-operations'
import type { MobileMachineFileEntry } from './machine-reply-schemas'
import type { MachineFileExportIntent } from './use-machine-file-export'

type Entry = { path: string; entry: MobileMachineFileEntry }

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Long-press actions for a row, plus the New Folder prompt; every change re-reads `folder`. */
export function useMachineEntryActions(args: {
  client: RpcClient | null
  machineId: string
  folder: string
  onChanged: () => void
  onExport: (path: string, intent: MachineFileExportIntent) => void
  showMessage: (message: string) => void
}) {
  const { client, machineId, folder, onChanged, onExport, showMessage } = args
  const t = useMobileTranslation()
  const clipboard = useClipboardWriter()
  const [selected, setSelected] = useState<Entry | null>(null)
  const [renaming, setRenaming] = useState<Entry | null>(null)
  const [deleting, setDeleting] = useState<Entry | null>(null)
  const [creatingFolder, setCreatingFolder] = useState(false)

  const run = async (work: (client: RpcClient) => Promise<void>, failure: string) => {
    if (!client) {
      return
    }
    try {
      await work(client)
      triggerSuccess()
      onChanged()
    } catch (error) {
      triggerError()
      showMessage(errorText(error, failure))
    }
  }

  const invalidName = t('seal.machines.invalidName', 'Names cannot contain / or \\')
  const submitName = (name: string, apply: (name: string) => void) => {
    if (!isValidMachineFileName(name)) {
      showMessage(invalidName)
      return
    }
    apply(name.trim())
  }

  const actions = (target: Entry): ActionSheetAction[] => {
    const isFile = !target.entry.isDirectoryLike
    return [
      ...(isFile
        ? [
            {
              id: 'share',
              label: t('seal.machines.actions.share', 'Share…'),
              icon: Share2,
              closeBeforePress: true,
              onPress: () => onExport(target.path, 'share')
            }
          ]
        : []),
      ...(isFile && classifyMobileArtifact(target.entry.name) === 'image'
        ? [
            {
              id: 'photos',
              label: t('seal.machines.actions.saveToPhotos', 'Save to Photos'),
              icon: ImageDown,
              closeBeforePress: true,
              onPress: () => onExport(target.path, 'photos')
            }
          ]
        : []),
      {
        id: 'rename',
        label: t('seal.machines.actions.rename', 'Rename'),
        icon: Edit3,
        closeBeforePress: true,
        onPress: () => setRenaming(target)
      },
      {
        id: 'copyPath',
        label: t('seal.machines.actions.copyPath', 'Copy Path'),
        icon: Copy,
        onPress: () => void clipboard.writeText(target.path).then(triggerSuccess, triggerError)
      },
      {
        id: 'delete',
        label: t('seal.machines.actions.delete', 'Delete'),
        icon: Trash2,
        destructive: true,
        closeBeforePress: true,
        onPress: () => setDeleting(target)
      }
    ]
  }

  const sheets = (
    <>
      <ActionSheetModal
        visible={selected !== null}
        title={selected?.entry.name}
        actions={selected ? actions(selected) : []}
        onClose={() => setSelected(null)}
      />
      <TextInputModal
        visible={renaming !== null}
        title={t('seal.machines.rename.title', 'Rename')}
        defaultValue={renaming?.entry.name ?? ''}
        selectTextOnFocus
        submitLabel={t('seal.machines.rename.submit', 'Rename')}
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          const target = renaming
          setRenaming(null)
          if (!target || name === target.entry.name) {
            return
          }
          submitName(name, (valid) => {
            const parent = machinePathDirname(target.path) ?? folder
            void run(
              (rpc) =>
                renameMachinePath(rpc, machineId, target.path, joinMachinePath(parent, valid)),
              t('seal.machines.rename.failed', 'Unable to rename')
            )
          })
        }}
      />
      <TextInputModal
        visible={creatingFolder}
        title={t('seal.machines.newFolder.title', 'New Folder')}
        placeholder={t('seal.machines.newFolder.placeholder', 'Folder name')}
        submitLabel={t('seal.machines.newFolder.submit', 'Create')}
        onCancel={() => setCreatingFolder(false)}
        onSubmit={(name) => {
          setCreatingFolder(false)
          submitName(name, (valid) => {
            void run(
              (rpc) => createMachineDirectory(rpc, machineId, joinMachinePath(folder, valid)),
              t('seal.machines.newFolder.failed', 'Unable to create the folder')
            )
          })
        }}
      />
      <ConfirmModal
        visible={deleting !== null}
        title={t('seal.machines.delete.title', 'Delete {{name}}?', {
          name: deleting?.entry.name ?? ''
        })}
        message={
          deleting?.entry.isDirectoryLike
            ? t(
                'seal.machines.delete.folderMessage',
                'The folder and everything in it are deleted.'
              )
            : t('seal.machines.delete.fileMessage', 'The file is deleted from the machine.')
        }
        confirmLabel={t('seal.machines.delete.confirm', 'Delete')}
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting
          setDeleting(null)
          if (target) {
            void run(
              (rpc) => removeMachinePaths(rpc, machineId, [target.path]),
              t('seal.machines.delete.failed', 'Unable to delete')
            )
          }
        }}
      />
    </>
  )

  return {
    openEntryActions: (path: string, entry: MobileMachineFileEntry) => setSelected({ path, entry }),
    openNewFolder: () => setCreatingFolder(true),
    sheets
  }
}
