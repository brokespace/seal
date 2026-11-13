import type { SealAccountKey, SealProvider } from './seal-accounts-config'
import type { SealAccountCandidate, SealAccountHealth } from './seal-account-candidates'
import { sealAccountKeysMatch } from './seal-account-key'
import type {
  SealAccountsStatus,
  SealSessionAssignment,
  SealSwapEvent
} from './seal-accounts-status'

/** One machine's account status as the page read it; `status` is null when it did not answer. */
export type SealFleetMachineReading = {
  id: string
  label: string
  /** The machine this page manages accounts from: sign-ins run here and pushes start here. */
  home: boolean
  status: SealAccountsStatus | null
  error: string | null
}

export type SealFleetMachine = Pick<SealFleetMachineReading, 'id' | 'label' | 'home' | 'error'> & {
  reachable: boolean
}

export const SEAL_ACCOUNT_GROUPS = ['claude', 'codex', 'apiKeys'] as const
export type SealAccountGroup = (typeof SEAL_ACCOUNT_GROUPS)[number]

/** One machine that holds an account's login. */
export type SealAccountPresence = {
  machineId: string
  machineLabel: string
  home: boolean
  health: SealAccountHealth
  /** New sessions on that machine start on this account. */
  active: boolean
  /** It is that machine's own `claude`/`codex` login. */
  systemLogin: boolean
  /** Open sessions on that machine running on it. */
  sessions: number
}

export type SealFleetAccount = {
  key: SealAccountKey
  provider: SealProvider
  group: SealAccountGroup
  /** The home machine's copy when it holds one, else the first machine's. */
  candidate: SealAccountCandidate
  onHome: boolean
  machines: SealAccountPresence[]
  /** Open sessions across every machine. */
  sessions: number
}

export type SealFleetSession = SealSessionAssignment & { machineId: string; machineLabel: string }
export type SealFleetSwap = SealSwapEvent & { machineId: string; machineLabel: string }

export type SealFleetOverview = {
  machines: SealFleetMachine[]
  groups: Record<SealAccountGroup, SealFleetAccount[]>
  sessions: SealFleetSession[]
  swaps: SealFleetSwap[]
  /** Accounts across every group. */
  total: number
}

const OK: SealAccountHealth = { state: 'ok' }

export function sealAccountGroup(candidate: SealAccountCandidate): SealAccountGroup {
  // A setup token is a Claude subscription login, so it sits with the Claude accounts.
  if (candidate.kind === 'api-key' && candidate.credential !== 'setup-token') {
    return 'apiKeys'
  }
  return candidate.provider
}

function isOpenOn(session: SealSessionAssignment, key: SealAccountKey): boolean {
  return (
    !session.endedAt && session.accountKey !== null && sealAccountKeysMatch(session.accountKey, key)
  )
}

function presence(
  machine: SealFleetMachineReading,
  candidate: SealAccountCandidate
): SealAccountPresence {
  return {
    machineId: machine.id,
    machineLabel: machine.label,
    home: machine.home,
    health: candidate.health ?? OK,
    active: candidate.active,
    systemLogin: candidate.systemLogin === true,
    sessions: (machine.status?.sessions ?? []).filter((session) => isOpenOn(session, candidate.key))
      .length
  }
}

function byPriority(a: SealFleetAccount, b: SealFleetAccount): number {
  return (
    a.candidate.priority - b.candidate.priority ||
    a.candidate.label.localeCompare(b.candidate.label)
  )
}

/**
 * One list of accounts for the whole fleet: every machine's logins merged by identity, with the
 * machines holding each one. The home machine's copy describes the account when it has one.
 */
export function buildSealFleetOverview(
  readings: readonly SealFleetMachineReading[]
): SealFleetOverview {
  // Home first, so its copy of a login is the one that describes the account.
  const ordered = [...readings].sort((a, b) => Number(b.home) - Number(a.home))
  const accounts: SealFleetAccount[] = []
  for (const machine of ordered) {
    for (const provider of ['claude', 'codex'] as const) {
      for (const candidate of machine.status?.providers[provider]?.candidates ?? []) {
        // An API key is one machine's secret; two machines never hold "the same" key.
        const known =
          candidate.kind === 'api-key'
            ? undefined
            : accounts.find(
                (entry) =>
                  entry.candidate.kind !== 'api-key' &&
                  entry.provider === provider &&
                  sealAccountKeysMatch(entry.key, candidate.key)
              )
        const held = presence(machine, candidate)
        if (known) {
          known.machines.push(held)
          known.sessions += held.sessions
          continue
        }
        accounts.push({
          key: candidate.key,
          provider,
          group: sealAccountGroup(candidate),
          candidate,
          onHome: machine.home,
          machines: [held],
          sessions: held.sessions
        })
      }
    }
  }
  const group = (name: SealAccountGroup): SealFleetAccount[] =>
    accounts.filter((account) => account.group === name).sort(byPriority)
  const tagged = <T>(pick: (status: SealAccountsStatus) => T[]) =>
    ordered.flatMap((machine) =>
      machine.status
        ? pick(machine.status).map((entry) => ({
            ...entry,
            machineId: machine.id,
            machineLabel: machine.label
          }))
        : []
    )
  return {
    machines: ordered.map((machine) => ({
      id: machine.id,
      label: machine.label,
      home: machine.home,
      error: machine.error,
      reachable: machine.status !== null
    })),
    groups: { claude: group('claude'), codex: group('codex'), apiKeys: group('apiKeys') },
    sessions: tagged((status) => status.sessions).sort((a, b) => b.at - a.at),
    swaps: tagged((status) => status.swapLog).sort((a, b) => b.at - a.at),
    total: accounts.length
  }
}
