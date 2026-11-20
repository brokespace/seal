import type {
  Connector,
  RefresherLease,
  SealConnectorsFleetHost,
  SealConnectorsFleetStatus,
  SignInHostState,
  SignInRef
} from '../../../../../shared/seal-connectors/seal-connectors-types'
import { sealAccountKeysMatch } from '../../../../../shared/seal-accounts/seal-account-key'

/** What one machine says about a sign-in, in the words the pages show. */
export type SignInState = 'connected' | 'missing' | 'expired' | 'stale' | 'needs-reconnect'

export type ConnectorSignInState =
  | 'no-sign-in-needed'
  | 'connected'
  | 'needs-sign-in'
  | 'waiting-for-refresh'
  | 'needs-reconnect'
  | 'not-on-this-machine'

/** The same service shows through claude.ai's own connectors; Seal lists only its own. */
export function isClaudeAiConnector(connector: Pick<Connector, 'name' | 'title'>): boolean {
  return /claude[._ -]?ai/i.test(connector.name) || /claude\.ai/i.test(connector.title)
}

export function visibleConnectors(connectors: readonly Connector[]): Connector[] {
  return connectors.filter((connector) => !isClaudeAiConnector(connector))
}

export function signInStateOn(
  state: SignInHostState | undefined,
  now: number,
  newestUpdatedAt: number | null = null
): SignInState {
  if (!state?.present) {
    return 'missing'
  }
  if (state.needsReconnect) {
    return 'needs-reconnect'
  }
  if (state.expiresAt !== null && state.expiresAt < now) {
    return 'expired'
  }
  if (newestUpdatedAt !== null && (state.updatedAt ?? 0) < newestUpdatedAt) {
    return 'stale'
  }
  return 'connected'
}

const STATE_RANK: Record<SignInState, number> = {
  connected: 0,
  stale: 1,
  expired: 2,
  missing: 3,
  'needs-reconnect': 4
}

/** The worst state among several sign-ins; null when there are none. */
export function worstSignInState(states: readonly SignInState[]): SignInState | null {
  return states.reduce<SignInState | null>(
    (worst, state) => (worst === null || STATE_RANK[state] > STATE_RANK[worst] ? state : worst),
    null
  )
}

function signInHostState(
  host: Pick<SealConnectorsFleetHost, 'status'> | null,
  signIn: SignInRef
): SignInHostState | undefined {
  return host?.status?.signIns.find((entry) => entry.id === signIn.id)
}

/** Sign-in status of one sign-in on the machine the desktop is on. */
export function signInStateOfOwnHost(
  signIn: SignInRef,
  signIns: readonly SignInHostState[],
  now: number
): SignInState {
  return signInStateOn(
    signIns.find((entry) => entry.id === signIn.id),
    now
  )
}

/** One pill for a connector's sign-ins on this host. */
export function connectorSignInState(
  connector: Connector,
  signIns: readonly SignInHostState[] | null,
  now: number
): ConnectorSignInState {
  if (connector.auth === 'none') {
    return 'no-sign-in-needed'
  }
  if (connector.signIns.length === 0) {
    return 'needs-sign-in'
  }
  if (!signIns) {
    return 'not-on-this-machine'
  }
  const worst = worstSignInState(
    connector.signIns.map((signIn) => signInStateOfOwnHost(signIn, signIns, now))
  )
  switch (worst) {
    case 'needs-reconnect':
      return 'needs-reconnect'
    case 'missing':
      return 'not-on-this-machine'
    case 'expired':
      return 'waiting-for-refresh'
    case 'connected':
    case 'stale':
    case null:
      return 'connected'
  }
}

/** Newest copy of each sign-in anywhere in the fleet, to tell which machines lag behind. */
export function newestSignInUpdates(fleet: SealConnectorsFleetStatus | null): Map<string, number> {
  const newest = new Map<string, number>()
  for (const host of fleet?.hosts ?? []) {
    for (const entry of host.status?.signIns ?? []) {
      if (entry.present && entry.updatedAt !== null) {
        newest.set(entry.id, Math.max(newest.get(entry.id) ?? 0, entry.updatedAt))
      }
    }
  }
  return newest
}

function listIncludes(list: 'all' | readonly string[], value: string | null): boolean {
  return list === 'all' || (value !== null && list.includes(value))
}

/** Whether a machine is in a scope's machine list. */
export function scopeHasMachine(
  machines: 'all' | readonly string[],
  hostKey: string | null
): boolean {
  return listIncludes(machines, hostKey)
}

/** Whether an account is in a scope's account list; keys saved before a login named its org still match. */
export function scopeHasAccount(accounts: 'all' | readonly string[], accountKey: string): boolean {
  return accounts === 'all' || accounts.some((entry) => sealAccountKeysMatch(entry, accountKey))
}

export type ConnectorOnHost = {
  connector: Connector
  /** Null for connectors that need no sign-in. */
  state: SignInState | null
}

/** Connectors that reach a machine, each with the worst state of the sign-ins it would use there. */
export function connectorsOnHost(
  connectors: readonly Connector[],
  host: SealConnectorsFleetHost,
  fleet: SealConnectorsFleetStatus | null,
  now: number
): ConnectorOnHost[] {
  const hostKey = host.status?.hostKey ?? null
  const newest = newestSignInUpdates(fleet)
  return visibleConnectors(connectors)
    .filter((connector) => scopeHasMachine(connector.appliesTo.machines, hostKey))
    .map((connector) => {
      if (connector.auth === 'none') {
        return { connector, state: null }
      }
      const states = connector.signIns
        .filter((signIn) => scopeHasMachine(signIn.appliesTo.machines, hostKey))
        .map((signIn) =>
          signInStateOn(signInHostState(host, signIn), now, newest.get(signIn.id) ?? null)
        )
      return { connector, state: worstSignInState(states) ?? 'missing' }
    })
}

export function connectorsForAccount(
  connectors: readonly Connector[],
  accountKey: string
): Connector[] {
  return visibleConnectors(connectors).filter((connector) =>
    scopeHasAccount(connector.appliesTo.accounts, accountKey)
  )
}

/** The lease the fleet agrees on: highest epoch, then the freshest heartbeat. */
export function currentRefresherLease(
  fleet: SealConnectorsFleetStatus | null
): RefresherLease | null {
  return (fleet?.hosts ?? []).reduce<RefresherLease | null>((best, host) => {
    const lease = host.status?.lease
    if (!lease || lease.ownerHostKey === null) {
      return best
    }
    if (
      best === null ||
      lease.epoch > best.epoch ||
      (lease.epoch === best.epoch && lease.heartbeatAt > best.heartbeatAt)
    ) {
      return lease
    }
    return best
  }, null)
}

export function hostByKey(
  fleet: SealConnectorsFleetStatus | null,
  hostKey: string | null
): SealConnectorsFleetHost | null {
  return hostKey === null
    ? null
    : (fleet?.hosts.find((host) => host.status?.hostKey === hostKey) ?? null)
}
