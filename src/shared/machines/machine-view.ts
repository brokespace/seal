import type { MachineConnectionType } from './machine-record'
import type { MachineId } from './machine-types'

export type MachineSshDetails = {
  targetId: string
  /** `user@host:port`. */
  address: string
  host: string
  username: string
  port: number
  identityFile: string | null
  jumpHost: string | null
}

export type MachineServerDetails = {
  environmentId: string
  name: string
  /** The preferred endpoint, or null for relay-only pairings. */
  endpoint: string | null
}

/** One machine as the renderer sees it; status comes from the live SSH and server states. */
export type MachineView = {
  id: MachineId
  recordId: string
  name: string
  /** The transport Seal uses now; the other one's details stay for one-click switching. */
  connection: MachineConnectionType
  ssh: MachineSshDetails | null
  server: MachineServerDetails | null
}

export type MachineWorktree = {
  path: string
  branch: string | null
  head: string | null
  bare: boolean
}
