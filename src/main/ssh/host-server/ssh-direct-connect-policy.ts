import type { SshManagedServerUpdateNote } from '../../../shared/ssh-types'
import type { HostServerOnConnectResult } from './ssh-host-server-on-connect'

/** Machines set to connect over SSH get a plain session: no Seal server is deployed or converted. */
type DirectSshPolicy = (targetId: string) => boolean

/** How a machine that asked for a Seal server takes the outcome of its setup. */
export type SshServerSetupOutcomes = {
  /** True when the machine connects over plain SSH instead of ending in the setup's failure. */
  failed: (targetId: string, failure: unknown) => boolean
  /** `update` is set when the server kept its version on this connect. */
  served: (targetId: string, environmentId: string, update?: SshManagedServerUpdateNote) => void
  /** The policy's plain session is up, so the host can be asked what the policy waited to know. */
  connectedDirectly?: (targetId: string) => void
}

let policy: DirectSshPolicy | null = null
let outcomes: SshServerSetupOutcomes | null = null

export function setDirectSshConnectPolicy(
  next: DirectSshPolicy | null,
  setup: SshServerSetupOutcomes | null = null
): void {
  policy = next
  outcomes = setup
}

export function connectsDirectlyOverSsh(targetId: string): boolean {
  return policy?.(targetId) ?? false
}

/** Stands in for the decision of a setup that failed on a machine that takes plain SSH instead. */
export const DIRECT_SSH_FALLBACK: HostServerOnConnectResult = {
  route: 'unserved',
  reason: 'refused'
}

/** `failure` is the thrown error or the unserved decision. */
export function fallsBackToDirectSsh(targetId: string, failure: unknown): boolean {
  return outcomes?.failed(targetId, failure) ?? false
}

export function noteSshHostServed(
  targetId: string,
  environmentId: string,
  update?: SshManagedServerUpdateNote
): void {
  outcomes?.served(targetId, environmentId, update)
}

export function noteSshConnectedDirectly(targetId: string): void {
  outcomes?.connectedDirectly?.(targetId)
}
