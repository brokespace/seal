import { firstParam } from '../../navigation/route-param-reader'
import { parseMobileMachineId } from './machine-reply-schemas'

// Object hrefs: Expo Router encodes the machine id, whose `:` (and any %-escapes) must survive as one segment.

export function machineDetailHref(hostId: string, machineId: string, path?: string) {
  return {
    pathname: '/h/[hostId]/seal/machines/[machineId]' as const,
    params: { hostId, machineId, ...(path ? { path } : {}) }
  }
}

export function machineFilePreviewHref(
  hostId: string,
  machineId: string,
  path: string,
  size: number
) {
  return {
    pathname: '/h/[hostId]/seal/machines/[machineId]/preview' as const,
    params: { hostId, machineId, path, size: String(size) }
  }
}

export type MachineRouteParams = {
  hostId?: string | string[]
  machineId?: string | string[]
  path?: string | string[]
  size?: string | string[]
}

export function readMachineRoute(params: MachineRouteParams): {
  hostId: string
  machineId: string | null
  path: string
  size: number | null
} {
  const size = Number(firstParam(params.size))
  return {
    hostId: firstParam(params.hostId),
    machineId: parseMobileMachineId(firstParam(params.machineId)),
    path: firstParam(params.path),
    size: Number.isFinite(size) && size >= 0 && firstParam(params.size) !== '' ? size : null
  }
}
