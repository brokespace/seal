/** Which SSH hosts get Seal's server as a service, and what the host answered. Set by the machine registry. */
import type { MachineServerInstall } from '../../../shared/machines/machine-record'

export type SealServerKeeper = NonNullable<MachineServerInstall['manager']>
export type SealServiceManager = Exclude<SealServerKeeper, 'detached'>

/** `prefer: 'pm2'` is the advanced option: PM2 ahead of the native manager. */
export type SealServiceWish = { prefer?: 'pm2' }

export type SealServiceOutcome = {
  /** `detached` when no manager works: started on connect, stops when idle. */
  manager: SealServerKeeper
  /** systemd only: false when enabling linger was refused. */
  linger?: boolean
  /** pm2 only: whether the user's own `pm2 startup` is configured; null when it cannot be told. */
  startsAtBoot?: boolean | null
}

type Wishes = (sshTargetId: string) => SealServiceWish | null
type OutcomeListener = (sshTargetId: string, outcome: SealServiceOutcome) => void

let wishes: Wishes | null = null
const listeners = new Set<OutcomeListener>()

/** Null keeps upstream's launch: hosts reached outside Machines, and machines that declined. */
export function setSealServiceWishes(next: Wishes | null): void {
  wishes = next
}

export function sealServiceWish(sshTargetId: string): SealServiceWish | null {
  return wishes?.(sshTargetId) ?? null
}

export function onSealServiceOutcome(listener: OutcomeListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function reportSealServiceOutcome(sshTargetId: string, outcome: SealServiceOutcome): void {
  for (const listener of listeners) {
    listener(sshTargetId, outcome)
  }
}
