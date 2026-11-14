export type MobilePairingConnectionMode = 'automatic' | 'local-only'

/** The Seal relay authenticates with the desktop's pairing key, so Relay needs no account. */
export function resolveMobilePairingConnectionMode(
  saved: MobilePairingConnectionMode | null | undefined
): MobilePairingConnectionMode {
  return saved === 'local-only' ? 'local-only' : 'automatic'
}
