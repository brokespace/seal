import { randomUUID } from 'node:crypto'
import { mkdtemp, open, rm, stat, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  PHONE_TRANSFER_CHUNK_BYTES,
  type PhoneDownloadChunk,
  type PhoneDownloadTicket,
  type PhoneUploadBeginResult
} from '../../shared/rpc-contract/phone-transfer-params'
import { attachmentMimeType } from '../home-chat/attachments/home-chat-attachments'

// Abandoned phone transfers (app killed mid-upload) are dropped after this long idle.
const IDLE_EXPIRY_MS = 10 * 60_000
const MAX_ACTIVE = 16

type StagedUpload = {
  dir: string
  path: string
  fileName: string
  size: number
  received: number
  handle: FileHandle
  expiry: ReturnType<typeof setTimeout>
}

type StagedDownload = {
  path: string
  fileName: string
  size: number
  /** Deleted when the phone finishes; host-owned originals are never removed. */
  ownedDir: string | null
  expiry: ReturnType<typeof setTimeout>
}

export type CommittedPhoneUpload = {
  path: string
  fileName: string
  size: number
  /** Removes the staging folder once the consumer has copied the file. */
  release: () => Promise<void>
}

const uploads = new Map<string, StagedUpload>()
const downloads = new Map<string, StagedDownload>()

function expireAfterIdle(onExpire: () => Promise<void>): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => void onExpire(), IDLE_EXPIRY_MS)
  timer.unref?.()
  return timer
}

export async function beginPhoneUpload(
  fileName: string,
  size: number
): Promise<PhoneUploadBeginResult> {
  if (uploads.size >= MAX_ACTIVE) {
    throw new Error('Too many uploads in progress; try again shortly.')
  }
  const dir = await mkdtemp(join(tmpdir(), 'seal-phone-upload-'))
  const path = join(dir, basename(fileName))
  const handle = await open(path, 'w')
  const uploadId = randomUUID()
  const expiry = expireAfterIdle(() => abortPhoneUpload(uploadId))
  uploads.set(uploadId, { dir, path, fileName, size, received: 0, handle, expiry })
  return { uploadId, chunkBytes: PHONE_TRANSFER_CHUNK_BYTES }
}

function requireUpload(uploadId: string): StagedUpload {
  const upload = uploads.get(uploadId)
  if (!upload) {
    throw new Error('This upload expired; start it again.')
  }
  clearTimeout(upload.expiry)
  upload.expiry = expireAfterIdle(() => abortPhoneUpload(uploadId))
  return upload
}

export async function appendPhoneUpload(
  uploadId: string,
  offset: number,
  dataBase64: string
): Promise<{ received: number }> {
  const upload = requireUpload(uploadId)
  if (offset !== upload.received) {
    throw new Error(`Expected offset ${upload.received}, got ${offset}`)
  }
  const data = Buffer.from(dataBase64, 'base64')
  if (upload.received + data.length > upload.size) {
    throw new Error('Upload is larger than announced')
  }
  await upload.handle.write(data, 0, data.length, offset)
  upload.received += data.length
  return { received: upload.received }
}

/** Hands the complete file to a consumer; the upload id stops being valid. */
export async function commitPhoneUpload(uploadId: string): Promise<CommittedPhoneUpload> {
  const upload = requireUpload(uploadId)
  uploads.delete(uploadId)
  clearTimeout(upload.expiry)
  await upload.handle.close()
  if (upload.received !== upload.size) {
    await rm(upload.dir, { recursive: true, force: true })
    throw new Error(`Upload incomplete: ${upload.received} of ${upload.size} bytes`)
  }
  return {
    path: upload.path,
    fileName: upload.fileName,
    size: upload.size,
    release: () => rm(upload.dir, { recursive: true, force: true })
  }
}

export async function abortPhoneUpload(uploadId: string): Promise<void> {
  const upload = uploads.get(uploadId)
  if (!upload) {
    return
  }
  uploads.delete(uploadId)
  clearTimeout(upload.expiry)
  await upload.handle.close().catch(() => {})
  await rm(upload.dir, { recursive: true, force: true })
}

/** Registers a host-local file for the phone to pull. `ownedDir` is removed when the phone is done. */
export async function openPhoneDownload(
  path: string,
  options: { fileName?: string; ownedDir?: string | null } = {}
): Promise<PhoneDownloadTicket> {
  const info = await stat(path)
  if (!info.isFile()) {
    throw new Error('Only files can be downloaded')
  }
  if (downloads.size >= MAX_ACTIVE) {
    throw new Error('Too many downloads in progress; try again shortly.')
  }
  const fileName = options.fileName ?? basename(path)
  const downloadId = randomUUID()
  downloads.set(downloadId, {
    path,
    fileName,
    size: info.size,
    ownedDir: options.ownedDir ?? null,
    expiry: expireAfterIdle(() => endPhoneDownload(downloadId))
  })
  return {
    downloadId,
    fileName,
    size: info.size,
    mimeType: attachmentMimeType(fileName),
    chunkBytes: PHONE_TRANSFER_CHUNK_BYTES
  }
}

export async function readPhoneDownload(
  downloadId: string,
  offset: number,
  length = PHONE_TRANSFER_CHUNK_BYTES
): Promise<PhoneDownloadChunk> {
  const download = downloads.get(downloadId)
  if (!download) {
    throw new Error('This download expired; start it again.')
  }
  clearTimeout(download.expiry)
  download.expiry = expireAfterIdle(() => endPhoneDownload(downloadId))
  if (offset >= download.size) {
    return { dataBase64: '', eof: true }
  }
  const end = Math.min(download.size, offset + Math.min(length, PHONE_TRANSFER_CHUNK_BYTES))
  const buffer = Buffer.alloc(end - offset)
  const handle = await open(download.path, 'r')
  try {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset)
    return {
      dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
      eof: bytesRead === 0 || offset + bytesRead >= download.size
    }
  } finally {
    await handle.close()
  }
}

export async function endPhoneDownload(downloadId: string): Promise<void> {
  const download = downloads.get(downloadId)
  if (!download) {
    return
  }
  downloads.delete(downloadId)
  clearTimeout(download.expiry)
  if (download.ownedDir) {
    await rm(download.ownedDir, { recursive: true, force: true })
  }
}
