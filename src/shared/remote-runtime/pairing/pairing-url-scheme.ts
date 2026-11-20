export const PAIRING_URL_SCHEME = 'seal'
// Codes from desktops released before the Seal rebrand still carry orca://.
const ACCEPTED_PAIRING_URL_SCHEMES = [PAIRING_URL_SCHEME, 'orca']

export const PAIRING_URL_PREFIX = `${PAIRING_URL_SCHEME}://pair`

export function isAcceptedPairingProtocol(protocol: string): boolean {
  return ACCEPTED_PAIRING_URL_SCHEMES.some((scheme) => protocol.toLowerCase() === `${scheme}:`)
}

/** Length of the accepted `scheme://` prefix, or null when the input uses another scheme. */
export function acceptedPairingSchemePrefixLength(input: string): number | null {
  const lower = input.toLowerCase()
  const scheme = ACCEPTED_PAIRING_URL_SCHEMES.find((candidate) =>
    lower.startsWith(`${candidate}://`)
  )
  return scheme ? scheme.length + 3 : null
}
