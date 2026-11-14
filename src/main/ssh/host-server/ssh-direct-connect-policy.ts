/** Machines set to connect over SSH get a plain session: no Seal server is deployed or converted. */
type DirectSshPolicy = (targetId: string) => boolean

let policy: DirectSshPolicy | null = null

export function setDirectSshConnectPolicy(next: DirectSshPolicy | null): void {
  policy = next
}

export function connectsDirectlyOverSsh(targetId: string): boolean {
  return policy?.(targetId) ?? false
}
