import { Directory, File as FsFile, Paths } from 'expo-file-system'
import type { PhoneDownloadTicket } from '../../../../src/shared/rpc-contract/phone-transfer-params'
import { translate } from '../../i18n/mobile-i18n'
import {
  decodeCanonicalBase64Bytes,
  encodeBase64Bytes
} from '../../transport/encryption/base64-byte-codec'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { presentShareSheet } from './phone-file-device'
import {
  phoneDownloadEnd,
  phoneDownloadRead,
  phoneUploadAbort,
  phoneUploadAppend,
  phoneUploadBegin
} from './phone-transfer-operations'

export type { PhoneDownloadTicket }

type TransferProgress = { onProgress?: (bytes: number) => void; signal?: AbortSignal }

// A chunk that cannot reach the host fails instead of replaying after a reconnect.
const CHUNK_REQUEST = { failWhenDisconnected: true, timeoutMs: 60_000 }
const DOWNLOAD_CACHE_FOLDER = 'seal-downloads'
const STALE_DOWNLOAD_MS = 60 * 60 * 1000

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error(translate('seal.transfers.cancelled', 'Transfer cancelled'))
  }
}

function changedDuringTransfer(): Error {
  return new Error(translate('seal.transfers.changed', 'The file changed during the transfer'))
}

/** Stages a phone file on the host; the caller commits the returned uploadId (e.g. sealMachines.uploadStaged). */
export async function uploadFileToHost(
  client: RpcClient,
  source: {
    uri: string
    fileName: string
    size: number
    onProgress?: (sentBytes: number) => void
    signal?: AbortSignal
  }
): Promise<{ uploadId: string }> {
  const { uri, fileName, size, onProgress, signal } = source
  throwIfAborted(signal)
  const handle = new FsFile(uri).open()
  try {
    const { uploadId, chunkBytes } = phoneUploadBegin.interpret(
      await phoneUploadBegin.request(client, { fileName, size })
    )
    try {
      let offset = 0
      while (offset < size) {
        throwIfAborted(signal)
        handle.offset = offset
        const bytes = await handle.readBytes(Math.min(chunkBytes, size - offset))
        if (bytes.byteLength === 0) {
          throw changedDuringTransfer()
        }
        const { received } = phoneUploadAppend.interpret(
          await phoneUploadAppend.request(
            client,
            { uploadId, offset, dataBase64: encodeBase64Bytes(bytes) },
            CHUNK_REQUEST
          )
        )
        if (received !== offset + bytes.byteLength) {
          throw changedDuringTransfer()
        }
        offset = received
        onProgress?.(offset)
      }
      throwIfAborted(signal)
      return { uploadId }
    } catch (error) {
      void phoneUploadAbort.request(client, { uploadId }).catch(() => undefined)
      throw error
    }
  } finally {
    handle.close()
  }
}

// Each download gets its own folder so a running share keeps its file; earlier ones expire here.
function freshDownloadFolder(): Directory {
  const root = new Directory(Paths.cache, DOWNLOAD_CACHE_FOLDER)
  if (root.exists) {
    for (const entry of root.list()) {
      const startedAt = Number(entry.name.split('-')[0])
      if (Number.isFinite(startedAt) && Date.now() - startedAt > STALE_DOWNLOAD_MS) {
        try {
          entry.delete()
        } catch {
          // Best effort; the OS reclaims the cache.
        }
      }
    }
  }
  const folder = new Directory(root, `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  folder.create({ intermediates: true })
  return folder
}

function cacheFileName(name: string): string {
  const cleaned = name.replace(/[\\/\0]/g, '_').trim()
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'download'
}

/** Pulls a host-side download ticket into the phone's cache; the ticket is always released. */
export async function downloadTicketToCache(
  client: RpcClient,
  ticket: PhoneDownloadTicket,
  options: TransferProgress = {}
): Promise<{ uri: string }> {
  const { onProgress, signal } = options
  const { downloadId } = ticket
  let folder: Directory | null = null
  try {
    throwIfAborted(signal)
    folder = freshDownloadFolder()
    const file = new FsFile(folder, cacheFileName(ticket.fileName))
    file.create({ overwrite: true })
    const handle = file.open()
    try {
      let offset = 0
      for (;;) {
        throwIfAborted(signal)
        const length = Math.min(ticket.chunkBytes, Math.max(1, ticket.size - offset))
        const chunk = phoneDownloadRead.interpret(
          await phoneDownloadRead.request(client, { downloadId, offset, length }, CHUNK_REQUEST)
        )
        const bytes = decodeCanonicalBase64Bytes(chunk.dataBase64)
        if (!bytes || bytes.byteLength > length) {
          throw changedDuringTransfer()
        }
        handle.writeBytesSync(bytes)
        offset += bytes.byteLength
        onProgress?.(offset)
        if (chunk.eof) {
          break
        }
        if (bytes.byteLength === 0) {
          throw changedDuringTransfer()
        }
      }
      if (offset !== ticket.size) {
        throw changedDuringTransfer()
      }
    } finally {
      handle.close()
    }
    throwIfAborted(signal)
    return { uri: file.uri }
  } catch (error) {
    try {
      folder?.delete()
    } catch {
      // Best effort; the OS reclaims the cache.
    }
    throw error
  } finally {
    void phoneDownloadEnd.request(client, { downloadId }).catch(() => undefined)
  }
}

/** Opens the system share sheet for a file in the phone's cache (Save to Files, AirDrop, other apps). */
export function shareLocalFile(uri: string, mimeType: string): Promise<void> {
  return presentShareSheet(uri, mimeType)
}
