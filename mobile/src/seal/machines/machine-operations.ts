import { LOCAL_EXECUTION_HOST_ID } from '../../../../src/shared/execution-host'
import * as z from 'zod'
import { PHONE_MACHINE_PREVIEW_MAX_BYTES } from '../../../../src/shared/rpc-contract/seal-machines-params'
import type { NO_HOST_LIST_INPUT } from '../../host-screen/catalog/host-list-queries'
import { defineHostQuery } from '../../query/host-query'
import type { HostQueryTarget } from '../../query/host-query-key'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import { phoneDownloadTicketSchema } from '../transfers/phone-transfer-operations'
import {
  machineDirListingSchema,
  machineFileReadSchema,
  machineListSchema,
  machineMetricsSchema,
  machineTransferListSchema,
  machineTransferSchema,
  type MobileMachineDirListing
} from './machine-reply-schemas'

const okSchema = z.unknown()

const machineList = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.list',
    method: 'sealMachines.list',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-list', machineListSchema)
  })
)

const machineMetrics = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.metrics',
    method: 'sealMachines.metrics',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-metrics', machineMetricsSchema)
  })
)

const machineListDir = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.list-dir',
    method: 'sealMachines.listDir',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-dir-listing', machineDirListingSchema)
  })
)

const machineReadFile = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.read-file',
    method: 'sealMachines.readFile',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-file-read', machineFileReadSchema)
  })
)

const machineCreateDir = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.create-dir',
    method: 'sealMachines.createDir',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-dir-created', okSchema)
  })
)

const machineRename = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.rename',
    method: 'sealMachines.rename',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-path-renamed', okSchema)
  })
)

const machineRemove = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.remove',
    method: 'sealMachines.remove',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-paths-removed', okSchema)
  })
)

const machineUploadStaged = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.upload-staged',
    method: 'sealMachines.uploadStaged',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-transfer', machineTransferSchema)
  })
)

const machineOpenDownload = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.open-download',
    method: 'sealMachines.openDownload',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('phone-download-ticket', phoneDownloadTicketSchema)
  })
)

const machineDownloadUrl = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.download-url',
    method: 'sealMachines.downloadUrl',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-transfer', machineTransferSchema)
  })
)

const machineListTransfers = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.list-transfers',
    method: 'sealMachines.listTransfers',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-transfer-list', machineTransferListSchema)
  })
)

const machineCancelTransfer = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.cancel-transfer',
    method: 'sealMachines.cancelTransfer',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-transfer-cancelled', okSchema)
  })
)

// Remote files are copied to the host before the ticket is issued, which can take a while.
const OPEN_DOWNLOAD_REQUEST = { timeoutMs: 10 * 60_000 }

export function machineQueryTarget(machineId: string): HostQueryTarget {
  return { exec: LOCAL_EXECUTION_HOST_ID, machine: machineId }
}

export const machinesListQuery = defineHostQuery<
  typeof NO_HOST_LIST_INPUT,
  z.output<typeof machineListSchema>['machines']
>({
  family: 'sealMachines.list',
  fetch: async (client) => machineList.interpret(await machineList.request(client)).machines,
  staleTime: 0
})

export const machineMetricsQuery = defineHostQuery({
  family: 'sealMachines.metrics',
  fetch: async (client, target: HostQueryTarget) =>
    machineMetrics.interpret(await machineMetrics.request(client, { machineId: target.exec })),
  staleTime: 15_000
})

async function readDirectoryPage(
  client: RpcClient,
  machineId: string,
  path: string,
  offset: number,
  force: boolean
): Promise<MobileMachineDirListing> {
  return machineListDir.interpret(
    await machineListDir.request(client, {
      machineId,
      ...(path ? { path } : {}),
      ...(offset > 0 ? { offset } : {}),
      ...(force ? { force } : {})
    })
  )
}

export function machineDirectoryHasMore(listing: MobileMachineDirListing): boolean {
  return listing.entries.length < listing.totalEntries
}

/** `previous` plus its next page, or null when the folder has no more rows. */
export async function readNextMachineDirectoryPage(
  client: RpcClient,
  machineId: string,
  previous: MobileMachineDirListing
): Promise<MobileMachineDirListing | null> {
  if (!machineDirectoryHasMore(previous)) {
    return null
  }
  const next = await readDirectoryPage(
    client,
    machineId,
    previous.path,
    previous.entries.length,
    false
  )
  if (next.path !== previous.path || next.entries.length === 0) {
    return null
  }
  return { ...next, offset: 0, entries: [...previous.entries, ...next.entries] }
}

// A refresh reads as many rows as were shown, so pages the user scrolled through survive it.
export async function readMachineDirectory(
  client: RpcClient,
  machineId: string,
  path: string,
  previous: MobileMachineDirListing | undefined,
  force: boolean
): Promise<MobileMachineDirListing> {
  const shown = previous?.entries.length ?? 0
  let listing = await readDirectoryPage(client, machineId, path, 0, force)
  while (machineDirectoryHasMore(listing) && listing.entries.length < shown) {
    const next = await readNextMachineDirectoryPage(client, machineId, listing)
    if (!next) {
      break
    }
    listing = { ...next, fromCache: listing.fromCache }
  }
  return listing
}

/** One listing per folder; `path` '' is the machine's home folder. */
export const machineDirectoryQuery = defineHostQuery({
  family: 'sealMachines.listDir',
  fetch: (client, target, input: { path: string }, previous: MobileMachineDirListing | undefined) =>
    readMachineDirectory(client, target.exec, input.path, previous, false),
  staleTime: 0
})

export const machineFilePreviewQuery = defineHostQuery({
  family: 'sealMachines.readFile',
  fetch: async (client, target, input: { path: string }) =>
    machineReadFile.interpret(
      await machineReadFile.request(client, {
        machineId: target.exec,
        path: input.path,
        maxBytes: PHONE_MACHINE_PREVIEW_MAX_BYTES
      })
    ),
  staleTime: 0,
  gcTime: 60_000
})

export const machineTransfersQuery = defineHostQuery<
  typeof NO_HOST_LIST_INPUT,
  z.output<typeof machineTransferListSchema>['transfers']
>({
  family: 'sealMachines.listTransfers',
  fetch: async (client) =>
    machineListTransfers.interpret(await machineListTransfers.request(client)).transfers,
  staleTime: 0
})

export async function createMachineDirectory(
  client: RpcClient,
  machineId: string,
  path: string
): Promise<void> {
  machineCreateDir.interpret(await machineCreateDir.request(client, { machineId, path }))
}

export async function renameMachinePath(
  client: RpcClient,
  machineId: string,
  from: string,
  to: string
): Promise<void> {
  machineRename.interpret(await machineRename.request(client, { machineId, from, to }))
}

export async function removeMachinePaths(
  client: RpcClient,
  machineId: string,
  paths: string[]
): Promise<void> {
  machineRemove.interpret(await machineRemove.request(client, { machineId, paths }))
}

export async function commitStagedUpload(
  client: RpcClient,
  machineId: string,
  destDir: string,
  uploadId: string
) {
  return machineUploadStaged.interpret(
    await machineUploadStaged.request(client, { machineId, destDir, uploadId })
  )
}

export async function openMachineDownload(client: RpcClient, machineId: string, path: string) {
  return machineOpenDownload.interpret(
    await machineOpenDownload.request(client, { machineId, path }, OPEN_DOWNLOAD_REQUEST)
  )
}

export async function startMachineUrlDownload(
  client: RpcClient,
  params: { machineId: string; url: string; destDir: string; fileName?: string }
) {
  return machineDownloadUrl.interpret(await machineDownloadUrl.request(client, params))
}

export async function cancelMachineTransfer(client: RpcClient, transferId: string): Promise<void> {
  machineCancelTransfer.interpret(await machineCancelTransfer.request(client, { transferId }))
}
