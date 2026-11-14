import type { MachineRecord, MachineSeparation } from './machine-record'

export type MachineSshTargetFacts = {
  id: string
  label: string
  host: string
  configHost?: string
}

export type MachineEnvironmentFacts = {
  id: string
  name: string
  /** Endpoint URLs; loopback ones (SSH tunnels) say nothing about which host serves them. */
  endpoints: readonly string[]
  /** The SSH target whose server this is (managed deploy) or tunnels to it. */
  linkedSshTargetId: string | null
  /** The machine name the server last reported. */
  machineName: string | null
}

export type MachineMergeReason = 'linked' | 'machine-id' | 'address' | 'hostname'
const REASON_SCORE: Record<MachineMergeReason, number> = {
  linked: 4,
  'machine-id': 3,
  address: 2,
  hostname: 1
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const HOSTNAME_LIKE = /^[a-z0-9][a-z0-9.-]*$/

export function normalizeMachineHost(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  let host = value.trim().toLowerCase()
  host = host.slice(host.lastIndexOf('@') + 1)
  if (host.startsWith('[')) {
    host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined)
  } else if (host.split(':').length === 2) {
    host = host.split(':')[0]
  }
  host = host.replace(/\.$/, '')
  return host.length > 0 ? host : null
}

function isIpAddress(host: string): boolean {
  return IPV4.test(host) || host.includes(':')
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host.startsWith('127.') || host === '::1' || host === '0.0.0.0'
}

/** `kessel-ml.tailnet.ts.net` and `kessel-ml` name the same host; IPs compare whole. */
export function shortHostname(value: string | null | undefined): string | null {
  const host = normalizeMachineHost(value)
  if (!host || !HOSTNAME_LIKE.test(host) || isLoopback(host)) {
    return null
  }
  return isIpAddress(host) ? null : host.split('.')[0]
}

export function endpointHost(endpoint: string): string | null {
  try {
    const host = normalizeMachineHost(new URL(endpoint).hostname)
    return host && !isLoopback(host) ? host : null
  } catch {
    return null
  }
}

export function compact(values: readonly (string | null)[]): Set<string> {
  return new Set(values.filter((value): value is string => value !== null))
}

export function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) {
    if (b.has(value)) {
      return true
    }
  }
  return false
}

export function isSeparated(
  separations: readonly MachineSeparation[],
  sshTargetId: string,
  environmentId: string
): boolean {
  return separations.some(
    (pair) => pair.sshTargetId === sshTargetId && pair.environmentId === environmentId
  )
}

export type Candidate = {
  ssh: MachineRecord
  server: MachineRecord
  reason: MachineMergeReason
}

export function matchReason(
  ssh: MachineRecord,
  server: MachineRecord,
  target: MachineSshTargetFacts,
  environment: MachineEnvironmentFacts,
  identifyingAddresses: ReadonlySet<string>
): MachineMergeReason | null {
  if (environment.linkedSshTargetId === target.id) {
    return 'linked'
  }
  const sshIds = new Set(ssh.machineIds)
  const serverIds = new Set(server.machineIds)
  if (sshIds.size > 0 && serverIds.size > 0) {
    // Both hosts proved who they are; only the same id is the same machine.
    return intersects(sshIds, serverIds) ? 'machine-id' : null
  }
  const targetAddresses = compact([
    normalizeMachineHost(target.host),
    normalizeMachineHost(target.configHost)
  ])
  const serverAddresses = compact(
    environment.endpoints.map(endpointHost).filter((host) => host && identifyingAddresses.has(host))
  )
  if (intersects(targetAddresses, serverAddresses)) {
    return 'address'
  }
  const sshNames = compact([
    shortHostname(target.host),
    shortHostname(target.configHost),
    ...ssh.hostnames.map(shortHostname)
  ])
  const serverNames = compact([
    shortHostname(environment.machineName),
    shortHostname(environment.name),
    ...server.hostnames.map(shortHostname),
    ...[...serverAddresses].map(shortHostname)
  ])
  return intersects(sshNames, serverNames) ? 'hostname' : null
}

/** An address several servers share (a relay) identifies none of them. */
export function identifyingServerAddresses(
  environments: readonly MachineEnvironmentFacts[]
): Set<string> {
  const counts = new Map<string, number>()
  for (const environment of environments) {
    for (const host of compact(environment.endpoints.map(endpointHost))) {
      counts.set(host, (counts.get(host) ?? 0) + 1)
    }
  }
  return new Set([...counts].filter(([, count]) => count === 1).map(([host]) => host))
}

/** Accept the strongest pairs first, and only pairs no equally strong rival contests. */
export function chooseMerges(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => REASON_SCORE[b.reason] - REASON_SCORE[a.reason])
  const claimed = new Set<string>()
  const chosen: Candidate[] = []
  for (const candidate of sorted) {
    if (claimed.has(candidate.ssh.id) || claimed.has(candidate.server.id)) {
      continue
    }
    const score = REASON_SCORE[candidate.reason]
    const contested = sorted.some(
      (other) =>
        other !== candidate &&
        REASON_SCORE[other.reason] === score &&
        !claimed.has(other.ssh.id) &&
        !claimed.has(other.server.id) &&
        (other.ssh.id === candidate.ssh.id || other.server.id === candidate.server.id)
    )
    if (contested) {
      continue
    }
    claimed.add(candidate.ssh.id)
    claimed.add(candidate.server.id)
    chosen.push(candidate)
  }
  return chosen
}
