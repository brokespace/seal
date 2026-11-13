import type { MachineExecResult } from '../../../shared/machines/machine-host-wire'
import type { MachineIdentity } from '../../../shared/machines/machine-record'
import type { MachineId, MachineMetrics } from '../../../shared/machines/machine-types'
import type { MachineFileSystem } from '../filesystem/machine-filesystem'
import type { LocalShellExecOptions } from '../exec/local-shell-exec'

export type MachineTransport = 'local' | 'ssh' | 'server'

export type MachineExecOptions = Omit<LocalShellExecOptions, 'maxOutputBytes'>

export type MachineShellDialect = 'posix' | 'powershell'

export type MachineShellOptions = {
  cols: number
  rows: number
  cwd?: string
  /** Runs in the login shell instead of an interactive prompt; agents launch this way. */
  command?: string
}

export type MachineShellHandlers = {
  onData(data: string): void
  onExit(exitCode: number | null): void
}

export type MachineShell = {
  write(data: string): void
  resize(cols: number, rows: number): void
  close(): void
}

/**
 * Everything a feature may do on a machine. SSH and Seal-server implementations must behave the
 * same; features never look at `transport` to decide what they can do.
 */
export type MachineConnection = {
  readonly machineId: MachineId
  readonly transport: MachineTransport
  isConnected(): boolean
  /** Connects on demand; resolves once the transport is usable. */
  connect(): Promise<void>
  dialect(): Promise<MachineShellDialect>
  exec(script: string, options: MachineExecOptions): Promise<MachineExecResult>
  /** `watch` always delivers changes here; hosts without a native feed are polled. */
  readonly files: MachineFileSystem
  metrics(): Promise<MachineMetrics>
  identity(): Promise<MachineIdentity>
  openShell(options: MachineShellOptions, handlers: MachineShellHandlers): Promise<MachineShell>
}
