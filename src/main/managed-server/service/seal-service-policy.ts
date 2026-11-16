/** Which SSH hosts get Seal's server as a service, and what the host answered. Set by the machine registry. */
import type {
  MachineServerKeeper,
  MachineServiceManager
} from '../../../shared/machines/machine-server-install'

export type SealServerKeeper = MachineServerKeeper
export type SealServiceManager = MachineServiceManager

/** `prefer` is the advanced option: that manager ahead of the one Seal would pick. launchd is used only when preferred. */
export type SealServiceWish = { prefer?: SealServiceManager }

export type SealServiceOutcome = {
  /** `detached` when no manager works: started on connect, stops when idle. */
  manager: SealServerKeeper
  /** systemd only: what logind answered; absent when it did not answer, which is not a refusal. */
  linger?: boolean
  /** pm2 only: whether the user's own `pm2 startup` is configured; null when it cannot be told. */
  startsAtBoot?: boolean | null
  /** The account the host names itself (`id -un`). */
  hostUser?: string
  /** macOS: launchd was asked for, but no one is logged in at the screen, so it holds no user service. */
  launchdNeedsLogin?: true
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
