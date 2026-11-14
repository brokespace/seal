import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'

export type MachineResourceKind = 'cpu' | 'memory' | 'disk'

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
