import type { IpcMainInvokeEvent } from 'electron'
import { parseMachineId, type MachineId } from '../../shared/machines/machine-types'

export function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function requireStrings(value: unknown, name: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every((v): v is string => typeof v === 'string' && v !== '')
  ) {
    throw new Error(`${name} is required`)
  }
  return value
}

export function machineIdOf(value: unknown): MachineId {
  const parsed = parseMachineId(requireString(value, 'machineId'))
  if (!parsed) {
    throw new Error('Unknown machine')
  }
  return parsed
}

export type MachineInvokeHandler = (
  args: Record<string, unknown>,
  event: IpcMainInvokeEvent
) => unknown
export type MachineInvokeRegistrar = (channel: string, handler: MachineInvokeHandler) => void
