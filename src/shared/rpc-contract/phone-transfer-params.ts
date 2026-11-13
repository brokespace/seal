import * as z from 'zod'
import { isValidBase64 } from './clipboard-params'

/** Per-request payload budget, matching clipboard uploads so relay frames stay small. */
export const PHONE_TRANSFER_CHUNK_BASE64_CHARS = 512 * 1024
export const PHONE_TRANSFER_CHUNK_BYTES = (PHONE_TRANSFER_CHUNK_BASE64_CHARS / 4) * 3
export const PHONE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024

const FileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !/[\\/\0]/.test(name) && name !== '.' && name !== '..', 'Invalid file name')

const Base64Chunk = z
  .string()
  .max(PHONE_TRANSFER_CHUNK_BASE64_CHARS, 'Chunk is too large')
  .refine(isValidBase64, 'Chunk must be base64')

export const PhoneUploadBeginParams = z
  .object({ fileName: FileName, size: z.number().int().nonnegative().max(PHONE_UPLOAD_MAX_BYTES) })
  .strict()

export const PhoneUploadAppendParams = z
  .object({
    uploadId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    dataBase64: Base64Chunk
  })
  .strict()

export const PhoneUploadIdParams = z.object({ uploadId: z.string().min(1) }).strict()

export const PhoneDownloadReadParams = z
  .object({
    downloadId: z.string().min(1),
    offset: z.number().int().nonnegative(),
    length: z.number().int().positive().max(PHONE_TRANSFER_CHUNK_BYTES).optional()
  })
  .strict()

export const PhoneDownloadIdParams = z.object({ downloadId: z.string().min(1) }).strict()

export type PhoneUploadBeginResult = { uploadId: string; chunkBytes: number }
export type PhoneUploadAppendResult = { received: number }

/** A host-side file the phone pulls in chunks via `phoneTransfer.read`. */
export type PhoneDownloadTicket = {
  downloadId: string
  fileName: string
  size: number
  mimeType: string
  chunkBytes: number
}

export type PhoneDownloadChunk = { dataBase64: string; eof: boolean }
