/** How long an install waits on an SSH host whose install lock another install holds. Set by the machine registry. */
export type InstallLockWait = {
  timeoutMs: number
  /** The lock is held, so this install now waits for it. */
  began(): void
  ended(): void
}

type Waits = (sshTargetId: string) => InstallLockWait | null

let waits: Waits | null = null

/** Null keeps upstream's wait: hosts reached outside Machines. */
export function setInstallLockWaits(next: Waits | null): void {
  waits = next
}

export function installLockWait(sshTargetId: string): InstallLockWait | null {
  return waits?.(sshTargetId) ?? null
}
