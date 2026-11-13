import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { uploadFileToHost } from '../transfers/phone-transfers'
import type { PhoneUploadSource } from '../transfers/phone-upload-source'
import { attachHomeChatUpload } from './home-chat-operations'

export type HomeChatPendingUpload = {
  key: string
  name: string
  size: number
  sent: number
  /** The host path the assistant opens; set once the upload is in the chat's folder. */
  path: string | null
}

let uploadSeq = 0

/** Phone files on their way into the chat's upload folder, ready to be named in the next message. */
export function useHomeChatUploads(
  client: RpcClient | null,
  chatId: string,
  onError: (name: string, error: unknown) => void
) {
  const [uploads, setUploads] = useState<HomeChatPendingUpload[]>([])
  const controllers = useRef(new Map<string, AbortController>())
  useEffect(() => {
    const running = controllers.current
    return () => {
      for (const controller of running.values()) {
        controller.abort()
      }
    }
  }, [])

  const patch = (key: string, change: Partial<HomeChatPendingUpload>) =>
    setUploads((current) =>
      current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload))
    )

  const add = useCallback(
    (sources: PhoneUploadSource[]) => {
      if (!client) {
        return
      }
      for (const source of sources) {
        const key = `upload-${++uploadSeq}`
        const controller = new AbortController()
        controllers.current.set(key, controller)
        setUploads((current) => [
          ...current,
          { key, name: source.fileName, size: source.size, sent: 0, path: null }
        ])
        uploadFileToHost(client, {
          uri: source.uri,
          fileName: source.fileName,
          size: source.size,
          signal: controller.signal,
          onProgress: (sent) => patch(key, { sent })
        })
          .then(({ uploadId }) => attachHomeChatUpload(client, chatId, uploadId))
          .then(({ path }) => {
            if (!controller.signal.aborted) {
              patch(key, { path, sent: source.size })
            }
          })
          .catch((error: unknown) => {
            if (!controller.signal.aborted) {
              setUploads((current) => current.filter((upload) => upload.key !== key))
              onError(source.fileName, error)
            }
          })
          .finally(() => controllers.current.delete(key))
      }
    },
    [client, chatId, onError]
  )

  const remove = useCallback((key: string) => {
    controllers.current.get(key)?.abort()
    controllers.current.delete(key)
    setUploads((current) => current.filter((upload) => upload.key !== key))
  }, [])

  const clear = useCallback(() => setUploads([]), [])

  return { uploads, add, remove, clear }
}

/** The message text plus one line per attached file, so the assistant can open each by path. */
export function homeChatMessageWithAttachments(
  text: string,
  uploads: readonly HomeChatPendingUpload[]
): string {
  const lines = uploads.flatMap((upload) => (upload.path ? [`Attached file: ${upload.path}`] : []))
  return [text.trim(), lines.join('\n')].filter(Boolean).join('\n\n')
}
