export type RelayCellOriginPin = {
  /** The director this host or phone was configured or paired with. */
  directorOrigin: string
  /** Further cell origins the build or operator named explicitly. */
  allowedCellOrigins?: readonly string[]
  /** Development hosts run director and cell on loopback HTTP. */
  allowLoopbackHttp?: boolean
}

export function isCanonicalRelayOrigin(value: string, allowLoopbackHttp = false): boolean {
  try {
    const url = new URL(value)
    const loopback =
      url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]'
    return (
      url.origin === value &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback && allowLoopbackHttp))
    )
  } catch {
    return false
  }
}

/**
 * A director may only name itself or a listed origin as the cell. Relay JWTs, host proofs,
 * invite tokens and resume tokens go to a cell, so an answer outside the pin is never followed.
 */
export function isPinnedRelayCellOrigin(cellUrl: string, pin: RelayCellOriginPin): boolean {
  if (!isCanonicalRelayOrigin(cellUrl, pin.allowLoopbackHttp)) {
    return false
  }
  return cellUrl === pin.directorOrigin || (pin.allowedCellOrigins ?? []).includes(cellUrl)
}
