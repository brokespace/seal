import * as z from 'zod'
import {
  PHONE_TRANSFER_CHUNK_BASE64_CHARS,
  PHONE_TRANSFER_CHUNK_BYTES
} from '../../../../src/shared/rpc-contract/phone-transfer-params'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'

const chunkSize = z.number().int().positive().max(PHONE_TRANSFER_CHUNK_BYTES)

export const phoneDownloadTicketSchema = z.looseObject({
  downloadId: z.string().min(1),
  fileName: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
  chunkBytes: chunkSize
})

export const phoneUploadBegin = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'phone-transfer.begin-upload',
    method: 'phoneTransfer.beginUpload',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'phone-upload-slot',
      z.looseObject({ uploadId: z.string().min(1), chunkBytes: chunkSize })
    )
  })
)

export const phoneUploadAppend = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'phone-transfer.append-upload',
    method: 'phoneTransfer.appendUpload',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'phone-upload-received',
      z.looseObject({ received: z.number().int().nonnegative() })
    )
  })
)

// Cleanup after a failure: its own outcome must not replace the error being reported.
export const phoneUploadAbort = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'phone-transfer.abort-upload-or-skip',
    method: 'phoneTransfer.abortUpload',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('phone-upload-aborted', z.unknown())
  })
)

export const phoneDownloadRead = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'phone-transfer.read-download',
    method: 'phoneTransfer.read',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant(
      'phone-download-chunk',
      z.looseObject({
        dataBase64: z.string().max(PHONE_TRANSFER_CHUNK_BASE64_CHARS),
        eof: z.boolean()
      })
    )
  })
)

export const phoneDownloadEnd = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'phone-transfer.end-download-or-skip',
    method: 'phoneTransfer.endDownload',
    acceptance: 'success-result-or-skip',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('phone-download-ended', z.unknown())
  })
)
