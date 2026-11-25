import { useCallback, useEffect, useRef, useState } from 'react'
import { PHONE_UPLOAD_MAX_BYTES } from '../../../../src/shared/rpc-contract/phone-transfer-params'
import { translate } from '../../i18n/mobile-i18n'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import type { PhoneUploadSource } from '../transfers/phone-upload-source'
import { uploadFileToHost } from '../transfers/phone-transfers'
import { commitStagedUpload } from './machine-operations'
import type { MobileMachineTransfer } from './machine-reply-schemas'

export type PhoneUploadItem = {
  key: string
  fileName: string
  size: number
  sent: number
  status: 'queued' | 'uploading' | 'failed'
  error: string | null
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : translate('seal.machines.upload.failed', 'Upload failed')
}

/** Sends picked phone files to the host one at a time, then hands each to the machine as a transfer. */
export function useMachineUploads(args: {
  client: RpcClient | null
  machineId: string
  onCommitted: (transfer: MobileMachineTransfer) => void
}) {
  const { client, machineId, onCommitted } = args
  const [items, setItems] = useState<PhoneUploadItem[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  const queue = useRef<Promise<void>>(Promise.resolve())
  const onCommittedRef = useRef(onCommitted)
  useEffect(() => {
    onCommittedRef.current = onCommitted
  }, [onCommitted])
  useEffect(() => {
    const running = controllers.current
    return () => {
      for (const controller of running.values()) {
        controller.abort()
      }
    }
  }, [])

  const update = useCallback((key: string, patch: Partial<PhoneUploadItem>) => {
    setItems((previous) =>
      previous.map((item) => (item.key === key ? { ...item, ...patch } : item))
    )
  }, [])
  const remove = useCallback((key: string) => {
    controllers.current.delete(key)
    setItems((previous) => previous.filter((item) => item.key !== key))
  }, [])

  const enqueue = useCallback(
    (sources: readonly PhoneUploadSource[], destDir: string) => {
      if (!client) {
        return
      }
      for (const source of sources) {
        const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
        const tooLarge = source.size > PHONE_UPLOAD_MAX_BYTES
        const controller = new AbortController()
        controllers.current.set(key, controller)
        setItems((previous) => [
          ...previous,
          {
            key,
            fileName: source.fileName,
            size: source.size,
            sent: 0,
            status: tooLarge ? 'failed' : 'queued',
            error: tooLarge
              ? translate('seal.machines.upload.tooLarge', 'Files over 2 GB cannot be uploaded')
              : null
          }
        ])
        if (tooLarge) {
          continue
        }
        queue.current = queue.current.then(async () => {
          if (controller.signal.aborted) {
            remove(key)
            return
          }
          update(key, { status: 'uploading' })
          try {
            const { uploadId } = await uploadFileToHost(client, {
              uri: source.uri,
              fileName: source.fileName,
              size: source.size,
              signal: controller.signal,
              onProgress: (sent) => update(key, { sent })
            })
            const transfer = await commitStagedUpload(client, machineId, destDir, uploadId)
            remove(key)
            onCommittedRef.current(transfer)
          } catch (error) {
            if (controller.signal.aborted) {
              remove(key)
            } else {
              update(key, { status: 'failed', error: errorText(error) })
            }
          }
        })
      }
    },
    [client, machineId, remove, update]
  )

  const cancel = useCallback((key: string) => {
    const controller = controllers.current.get(key)
    controller?.abort()
    setItems((previous) => {
      const item = previous.find((entry) => entry.key === key)
      // A queued or failed row has no read in flight to observe the abort, so it leaves now.
      return item && item.status !== 'uploading'
        ? previous.filter((entry) => entry.key !== key)
        : previous
    })
  }, [])

  return { uploads: items, enqueue, cancel }
}
