import { join } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../../shared/file-content/node-bounded-file-reader'
import {
  EMPTY_MACHINE_STORE,
  MachineStoreSchema,
  type MachineStore
} from '../../../shared/machines/machine-record'
import { writeSecureJsonFileWithinLimit } from '../../../shared/secure-storage/bounded-secure-json-file'

const MACHINES_FILE = 'seal-machines.json'
const MAX_MACHINE_STORE_BYTES = 1024 * 1024

export function machineStorePath(userDataPath: string): string {
  return join(userDataPath, MACHINES_FILE)
}

/** A missing or unreadable file starts empty; the next reconcile rebuilds it from the stores it binds. */
export function readMachineStore(userDataPath: string): MachineStore {
  try {
    const read = readNodeFileSyncWithinLimit(
      machineStorePath(userDataPath),
      MAX_MACHINE_STORE_BYTES,
      {
        regularFileOnly: true
      }
    )
    const parsed = MachineStoreSchema.safeParse(JSON.parse(read.buffer.toString('utf8')))
    return parsed.success ? parsed.data : EMPTY_MACHINE_STORE
  } catch {
    return EMPTY_MACHINE_STORE
  }
}

export function writeMachineStore(userDataPath: string, store: MachineStore): void {
  writeSecureJsonFileWithinLimit(machineStorePath(userDataPath), store, MAX_MACHINE_STORE_BYTES)
}
