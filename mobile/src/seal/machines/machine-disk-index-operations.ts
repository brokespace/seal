import { defineHostQuery } from '../../query/host-query'
import { bindDeferredRpcOperation, defineRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import {
  machineDiskLargestSchema,
  machineDiskListingSchema,
  machineDiskStatusSchema
} from './machine-disk-index-schemas'

// One host method answers all three questions; each reads the reply it asked for.
const diskStatus = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.disk-index-status',
    method: 'sealMachines.diskIndex',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-disk-status', machineDiskStatusSchema)
  })
)

const diskListing = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.disk-index-listing',
    method: 'sealMachines.diskIndex',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-disk-listing', machineDiskListingSchema)
  })
)

const diskLargest = bindDeferredRpcOperation(
  defineRpcOperation({
    name: 'seal-machines.disk-index-largest',
    method: 'sealMachines.diskIndex',
    acceptance: 'require-result-or-throw-message',
    barrier: 'after-caller-barrier',
    read: rpcResultVariant('machine-disk-largest', machineDiskLargestSchema)
  })
)

/** The machine's disks and how current its background index is. */
export const machineDiskStatusQuery = defineHostQuery({
  family: 'sealMachines.diskIndex.status',
  fetch: async (client, target) =>
    diskStatus.interpret(
      await diskStatus.request(client, { machineId: target.exec, request: { op: 'status' } })
    ).status,
  staleTime: 0
})

/** One folder with sizes from the index. */
export const machineDiskListingQuery = defineHostQuery({
  family: 'sealMachines.diskIndex.list',
  fetch: async (client, target, input: { path: string }) =>
    diskListing.interpret(
      await diskListing.request(client, {
        machineId: target.exec,
        request: { op: 'list', path: input.path }
      })
    ).listing,
  staleTime: 0
})

export const machineDiskLargestQuery = defineHostQuery({
  family: 'sealMachines.diskIndex.largest',
  fetch: async (client, target, input: { mount: string; kind: 'files' | 'folders' }) =>
    diskLargest.interpret(
      await diskLargest.request(client, {
        machineId: target.exec,
        request: { op: 'largest', kind: input.kind, mount: input.mount }
      })
    ).largest,
  staleTime: 0
})
