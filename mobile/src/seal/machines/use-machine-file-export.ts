import { useCallback, useEffect, useRef, useState } from 'react'
import { machinePathBasename } from '../../../../src/shared/machines/machine-paths'
import { translate } from '../../i18n/mobile-i18n'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { presentPdfViewer, saveImageToLibrary } from '../transfers/phone-file-device'
import { downloadTicketToCache, shareLocalFile } from '../transfers/phone-transfers'
import { openMachineDownload } from './machine-operations'

export type MachineFileExportIntent = 'share' | 'photos' | 'pdf'

export type MachineFileExportProgress = { fileName: string; received: number; total: number | null }

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : translate('seal.machines.export.failed', 'Unable to download the file')
}

/** Copies one machine file into the phone's cache, then shares it, saves it to Photos or opens it. */
export function useMachineFileExport(args: {
  client: RpcClient | null
  machineId: string
  onError: (message: string) => void
  onSaved: (message: string) => void
}) {
  const { client, machineId, onError, onSaved } = args
  const [progress, setProgress] = useState<MachineFileExportProgress | null>(null)
  const current = useRef<AbortController | null>(null)
  useEffect(() => () => current.current?.abort(), [])

  const download = useCallback(
    async (path: string): Promise<{ uri: string; mimeType: string } | null> => {
      if (!client) {
        return null
      }
      current.current?.abort()
      const controller = new AbortController()
      current.current = controller
      const fileName = machinePathBasename(path)
      setProgress({ fileName, received: 0, total: null })
      try {
        const ticket = await openMachineDownload(client, machineId, path)
        setProgress({ fileName, received: 0, total: ticket.size })
        const { uri } = await downloadTicketToCache(client, ticket, {
          signal: controller.signal,
          onProgress: (received) => setProgress({ fileName, received, total: ticket.size })
        })
        return controller.signal.aborted ? null : { uri, mimeType: ticket.mimeType }
      } catch (error) {
        if (!controller.signal.aborted) {
          onError(errorText(error))
        }
        return null
      } finally {
        if (current.current === controller) {
          current.current = null
          setProgress(null)
        }
      }
    },
    [client, machineId, onError]
  )

  const exportFile = useCallback(
    async (path: string, intent: MachineFileExportIntent) => {
      const file = await download(path)
      if (!file) {
        return
      }
      try {
        if (intent === 'share') {
          await shareLocalFile(file.uri, file.mimeType)
        } else if (intent === 'photos') {
          await saveImageToLibrary(file.uri, file.mimeType)
          onSaved(translate('seal.machines.export.savedToPhotos', 'Saved to Photos'))
        } else {
          await presentPdfViewer(file.uri)
        }
      } catch (error) {
        onError(errorText(error))
      }
    },
    [download, onError, onSaved]
  )

  const cancel = useCallback(() => {
    current.current?.abort()
    current.current = null
    setProgress(null)
  }, [])

  return { progress, download, exportFile, cancel }
}
