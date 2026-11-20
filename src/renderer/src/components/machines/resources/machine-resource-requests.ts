import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type {
  MachineDiskIndexLargest,
  MachineDiskIndexListing,
  MachineDiskIndexReply,
  MachineDiskIndexRequest,
  MachineDiskIndexStatus
} from '../../../../../shared/machines/machine-disk-index-types'
import type { MachineId } from '../../../../../shared/machines/machine-types'

export type MachineResourceKind = 'cpu' | 'memory' | 'disk' | 'gpu'

export function machineResourceApi(): NonNullable<typeof window.api.machines> {
  const api = window.api.machines
  if (!api) {
    throw new Error('Machine details need the desktop app')
  }
  return api
}

export function resourceErrorText(error: unknown): string {
  return readIpcErrorMessage(error) ?? String(error)
}

type DiskIndexAnswer = Extract<MachineDiskIndexReply, { ok: true }>

async function askDiskIndex(
  machineId: MachineId,
  request: MachineDiskIndexRequest
): Promise<DiskIndexAnswer> {
  const reply = await machineResourceApi().diskIndex({ machineId, request })
  if (!reply.ok) {
    throw new Error(reply.message)
  }
  return reply
}

/** Status of the machine's disk index; also what every change to the index answers with. */
export async function requestDiskIndexStatus(
  machineId: MachineId,
  request: Exclude<MachineDiskIndexRequest, { op: 'list' | 'largest' }> = { op: 'status' }
): Promise<MachineDiskIndexStatus> {
  const reply = await askDiskIndex(machineId, request)
  if (!('status' in reply)) {
    throw new Error('The disk index sent an unexpected reply.')
  }
  return reply.status
}

export async function requestDiskIndexListing(
  machineId: MachineId,
  path: string
): Promise<MachineDiskIndexListing> {
  const reply = await askDiskIndex(machineId, { op: 'list', path })
  if (!('listing' in reply)) {
    throw new Error('The disk index sent an unexpected reply.')
  }
  return reply.listing
}

export async function requestDiskIndexLargest(
  machineId: MachineId,
  mount: string,
  kind: MachineDiskIndexLargest['kind']
): Promise<MachineDiskIndexLargest> {
  const reply = await askDiskIndex(machineId, { op: 'largest', kind, mount })
  if (!('largest' in reply)) {
    throw new Error('The disk index sent an unexpected reply.')
  }
  return reply.largest
}
