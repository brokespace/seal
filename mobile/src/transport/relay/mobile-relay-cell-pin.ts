import { isPinnedRelayCellOrigin } from '../../../../src/shared/remote-runtime/relay/relay-cell-origin-pin'
import {
  SEAL_BUILD_RELAY_CELL_ORIGINS,
  SEAL_BUILD_SERVICE_ORIGINS
} from '../../../../src/shared/seal-cloud/seal-service-origins'

type RelayRoute = { directorUrl: string; cellUrl: string }

// Invite and resume tokens go to the cell, so a director answer or stored route outside the pin is never dialed.
export class RelayCellOutsidePinError extends Error {
  readonly name = 'RelayCellOutsidePinError'

  constructor() {
    super('relay cell is outside the origins this host may use')
  }
}

/** A phone follows a host's director only to that director, this build's relay, or a cell the build lists. */
export function isPinnedMobileRelayCell(relay: RelayRoute): boolean {
  return isPinnedRelayCellOrigin(relay.cellUrl, {
    directorOrigin: relay.directorUrl,
    allowedCellOrigins: [SEAL_BUILD_SERVICE_ORIGINS.relay, ...SEAL_BUILD_RELAY_CELL_ORIGINS]
  })
}

export function assertPinnedMobileRelayCell(relay: RelayRoute): void {
  if (!isPinnedMobileRelayCell(relay)) {
    throw new RelayCellOutsidePinError()
  }
}

export function isBuildRelayDirector(directorUrl: string): boolean {
  return directorUrl === SEAL_BUILD_SERVICE_ORIGINS.relay
}
