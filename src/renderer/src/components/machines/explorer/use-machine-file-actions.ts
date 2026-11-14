import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import {
  isValidMachineFileName,
  joinMachinePath,
  machinePathBasename,
  machinePathDirname
} from '../../../../../shared/machines/machine-paths'
import type { MachinePromptRequest } from './MachinePromptDialog'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function machinesApi(): NonNullable<typeof window.api.machines> {
  const api = window.api.machines
  if (!api) {
    throw new Error('Machine file access needs the desktop app')
  }
  return api
}

export type MachineFileActions = {
  prompt: MachinePromptRequest | null
  closePrompt: () => void
  pendingDelete: string[] | null
  closeDelete: () => void
  confirmDelete: (paths: string[]) => Promise<void>
  newFolder: (parent: string) => void
  rename: (path: string) => void
  requestDelete: (paths: string[]) => void
  download: (paths: string[]) => void
  uploadPaths: (localPaths: string[], destDir: string) => void
  pickAndUpload: (destDir: string) => void
  downloadUrl: (destDir: string) => void
}

export function useMachineFileActions(
  machineId: MachineId,
  refresh: (path: string) => void
): MachineFileActions {
  const t = useTranslate()
  const [prompt, setPrompt] = useState<MachinePromptRequest | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)

  const nameField = useCallback(
    (initialValue: string) => ({
      id: 'machine-file-name',
      label: t('auto.components.machines.actions.nameLabel', 'Name'),
      initialValue,
      validate: (value: string) =>
        isValidMachineFileName(value)
          ? null
          : t('auto.components.machines.actions.invalidName', 'Enter a name without slashes.')
    }),
    [t]
  )

  const newFolder = useCallback(
    (parent: string) => {
      setPrompt({
        title: t('auto.components.machines.actions.newFolderTitle', 'New folder'),
        description: parent,
        confirmLabel: t('auto.components.machines.actions.create', 'Create'),
        fields: [nameField('')],
        onSubmit: async ([name]) => {
          await machinesApi().createDir({ machineId, path: joinMachinePath(parent, name ?? '') })
          refresh(parent)
        }
      })
    },
    [machineId, nameField, refresh, t]
  )

  const rename = useCallback(
    (path: string) => {
      const parent = machinePathDirname(path) ?? path
      const current = machinePathBasename(path)
      setPrompt({
        title: t('auto.components.machines.actions.renameTitle', 'Rename {{name}}', {
          name: current
        }),
        confirmLabel: t('auto.components.machines.actions.rename', 'Rename'),
        fields: [nameField(current)],
        onSubmit: async ([name]) => {
          if (!name || name === current) {
            return
          }
          await machinesApi().rename({ machineId, from: path, to: joinMachinePath(parent, name) })
          refresh(parent)
        }
      })
    },
    [machineId, nameField, refresh, t]
  )

  const confirmDelete = useCallback(
    async (paths: string[]) => {
      await machinesApi().remove({ machineId, paths })
      for (const parent of new Set(paths.map((path) => machinePathDirname(path) ?? path))) {
        refresh(parent)
      }
    },
    [machineId, refresh]
  )

  const download = useCallback(
    (paths: string[]) => {
      void machinesApi()
        .download({ machineId, paths })
        .catch((error: unknown) => toast.error(errorText(error)))
    },
    [machineId]
  )

  const uploadPaths = useCallback(
    (localPaths: string[], destDir: string) => {
      if (localPaths.length === 0) {
        return
      }
      void machinesApi()
        .upload({ machineId, localPaths, destDir })
        .catch((error: unknown) => toast.error(errorText(error)))
    },
    [machineId]
  )

  const pickAndUpload = useCallback(
    (destDir: string) => {
      void window.api.shell
        .pickAttachments()
        .then((paths) => uploadPaths(paths, destDir))
        .catch((error: unknown) => toast.error(errorText(error)))
    },
    [uploadPaths]
  )

  const downloadUrl = useCallback(
    (destDir: string) => {
      setPrompt({
        title: t('auto.components.machines.actions.urlTitle', 'Download from URL'),
        description: t(
          'auto.components.machines.actions.urlDescription',
          'The machine fetches the file itself, so it never passes through this computer. Saving to {{dir}}.',
          { dir: destDir }
        ),
        confirmLabel: t('auto.components.machines.actions.urlConfirm', 'Download'),
        fields: [
          {
            id: 'machine-download-url',
            label: t('auto.components.machines.actions.urlLabel', 'URL'),
            initialValue: '',
            validate: (value) => {
              try {
                const protocol = new URL(value).protocol
                return protocol === 'http:' || protocol === 'https:'
                  ? null
                  : t('auto.components.machines.actions.urlInvalid', 'Enter an http or https URL.')
              } catch {
                return t(
                  'auto.components.machines.actions.urlInvalid',
                  'Enter an http or https URL.'
                )
              }
            }
          },
          {
            id: 'machine-download-name',
            label: t('auto.components.machines.actions.urlFileName', 'File name (optional)'),
            initialValue: '',
            validate: (value) =>
              value === '' || isValidMachineFileName(value)
                ? null
                : t('auto.components.machines.actions.invalidName', 'Enter a name without slashes.')
          }
        ],
        onSubmit: async ([url, fileName]) => {
          await machinesApi().downloadUrl({
            machineId,
            url: url ?? '',
            destDir,
            fileName: fileName || undefined
          })
        }
      })
    },
    [machineId, t]
  )

  return {
    prompt,
    closePrompt: useCallback(() => setPrompt(null), []),
    pendingDelete,
    closeDelete: useCallback(() => setPendingDelete(null), []),
    confirmDelete,
    newFolder,
    rename,
    requestDelete: setPendingDelete,
    download,
    uploadPaths,
    pickAndUpload,
    downloadUrl
  }
}
