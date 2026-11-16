import { z } from 'zod'
import type { E2EEKeypair } from '../../rpc/server/pairing/e2ee-keypair'
import { cancelUnreadResponseBody } from '../../../lib/unread-response-body'
import { parseRetryAfterHeaderMs } from '../../../../shared/network/retry-after-header'
import {
  isCanonicalRelayOrigin,
  isPinnedRelayCellOrigin
} from '../../../../shared/remote-runtime/relay/relay-cell-origin-pin'
import { deriveRelayHostId } from '../../../../shared/remote-runtime/relay/relay-host-id'
import { resolveSealRelayCellOrigins } from '../../../../shared/seal-cloud/seal-service-origins'
import {
  RelayAssignAbortedError,
  RelayAssignRateLimitedError,
  relayAssignRateKey,
  sharedRelayAssignRateGate,
  type RelayAssignRateGate
} from './relay-assign-rate-gate'
import type { RelayRegion } from '../region-selection/relay-region-probe'
import {
  RelayRegionCorrectionResponseSchema,
  type RelayRegionCorrectionRequest
} from '../region-selection/relay-region-correction-protocol'

const RELAY_HTTP_REQUEST_DEADLINE_MS = 15_000
const RELAY_RETRY_AFTER_MAX_MS = 5 * 60_000

const RelayTokenResponseSchema = z
  .object({
    relayToken: z
      .string()
      .min(1)
      .max(8 * 1024),
    expiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
  })
  .strict()

const AssignmentResponseSchema = z
  .object({
    v: z.literal(1),
    cellUrl: z.string().min(1).max(2048),
    assignmentEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    lease: z
      .string()
      .min(1)
      .max(8 * 1024),
    regionCorrection: RelayRegionCorrectionResponseSchema.optional().catch(undefined)
  })
  .strict()

export type RelayAuthorization = z.infer<typeof RelayTokenResponseSchema>
export type RelayAssignment = z.infer<typeof AssignmentResponseSchema>

export class RelayHttpError extends Error {
  constructor(
    readonly operation: 'token-exchange' | 'assignment',
    readonly statusCode: number,
    readonly retryAfterMs: number | null = null
  ) {
    super(`relay_${operation}_failed_${statusCode}`)
  }
}

// Distinguish local pacing from director 429s so one refusal does not look like many.
export class RelayAssignLocallyPacedError extends RelayHttpError {
  constructor(retryAfterMs: number) {
    super('assignment', 429, retryAfterMs)
    this.message = 'relay_assignment_locally_paced_429'
  }
}

function relayRetryAfterMs(value: string | null): number | null {
  return parseRetryAfterHeaderMs(value, RELAY_RETRY_AFTER_MAX_MS)
}

export function shouldRetryRelayConnectionError(error: unknown): boolean {
  if (error instanceof RelayAssignAbortedError) {
    return false
  }
  if (!(error instanceof RelayHttpError)) {
    return true
  }
  return (
    error.statusCode >= 500 ||
    error.statusCode === 408 ||
    error.statusCode === 425 ||
    error.statusCode === 429
  )
}

export { deriveRelayHostId }

/** The host follows a director only to itself or to a cell the build or `SEAL_RELAY_CELL_ORIGINS` lists. */
export function isPinnedHostRelayCell(
  directorUrl: string,
  cellUrl: string,
  allowedCellOrigins: readonly string[] = resolveSealRelayCellOrigins(process.env)
): boolean {
  return isPinnedRelayCellOrigin(cellUrl, {
    directorOrigin: directorUrl,
    allowedCellOrigins,
    allowLoopbackHttp: true
  })
}

export async function exchangeRelayAuthorization(input: {
  endpoint: string
  accessToken: string
  keypair: E2EEKeypair
  fetch?: typeof globalThis.fetch
  requestDeadlineMs?: number
}): Promise<RelayAuthorization> {
  const relayHostId = deriveRelayHostId(input.keypair.publicKey)
  const response = await (input.fetch ?? globalThis.fetch)(input.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(input.requestDeadlineMs ?? RELAY_HTTP_REQUEST_DEADLINE_MS),
    body: JSON.stringify({ relayHostId, hostPublicKeyB64: input.keypair.publicKeyB64 })
  })
  if (!response.ok) {
    const retryAfterMs = relayRetryAfterMs(response.headers.get('retry-after'))
    await cancelUnreadResponseBody(response)
    throw new RelayHttpError('token-exchange', response.status, retryAfterMs)
  }
  const parsed = RelayTokenResponseSchema.safeParse(await response.json())
  if (!parsed.success) {
    throw new RelayHttpError('token-exchange', 502)
  }
  return parsed.data
}

type RelayAssignmentRequest = {
  directorUrl: string
  relayToken: string
  relayHostId: string
  reconnect?: boolean
  preferredRegion?: RelayRegion
  regionCorrection?: RelayRegionCorrectionRequest
  fetch?: typeof globalThis.fetch
  requestDeadlineMs?: number
  isCurrent?: () => boolean
  assignRateGate?: RelayAssignRateGate
  allowedCellOrigins?: readonly string[]
}

export async function requestRelayAssignment(
  input: RelayAssignmentRequest
): Promise<RelayAssignment> {
  if (!isCanonicalRelayOrigin(input.directorUrl, true)) {
    throw new RelayHttpError('assignment', 400)
  }
  const gate = input.assignRateGate ?? sharedRelayAssignRateGate
  const rateKey = relayAssignRateKey(input.directorUrl, input.relayHostId)
  try {
    await gate.reserve(rateKey, input.isCurrent)
  } catch (error) {
    if (error instanceof RelayAssignRateLimitedError) {
      // Expose over-budget Retry-After as paced 429 so schedulers retry without parking pairing IPC.
      throw new RelayAssignLocallyPacedError(error.retryAfterMs)
    }
    throw error
  }
  return await sendRelayAssignment(input, gate, rateKey)
}

// Compatibility field retries are one logical attempt/slot; rebooking would add 5s per fallback.
async function sendRelayAssignment(
  input: RelayAssignmentRequest,
  gate: RelayAssignRateGate,
  rateKey: string
): Promise<RelayAssignment> {
  // Superseded callers cannot assign after booking or between compatibility retries.
  if (input.isCurrent && !input.isCurrent()) {
    throw new RelayAssignAbortedError()
  }
  const response = await (input.fetch ?? globalThis.fetch)(`${input.directorUrl}/v1/assign`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.relayToken}`,
      'content-type': 'application/json'
    },
    signal: AbortSignal.timeout(input.requestDeadlineMs ?? RELAY_HTTP_REQUEST_DEADLINE_MS),
    body: JSON.stringify({
      v: 1,
      relayHostId: input.relayHostId,
      ...(input.regionCorrection ? { regionCorrection: input.regionCorrection } : {}),
      ...(input.preferredRegion ? { preferredRegion: input.preferredRegion } : {}),
      ...(input.reconnect ? { reconnect: true } : {})
    })
  })
  if (!response.ok) {
    const retryAfterMs = relayRetryAfterMs(response.headers.get('retry-after'))
    if (retryAfterMs !== null) {
      gate.noteRetryAfter(rateKey, retryAfterMs)
    }
    await cancelUnreadResponseBody(response)
    if (input.regionCorrection && response.status === 400) {
      return await sendRelayAssignment({ ...input, regionCorrection: undefined }, gate, rateKey)
    }
    if (input.preferredRegion && response.status === 400) {
      return await sendRelayAssignment({ ...input, preferredRegion: undefined }, gate, rateKey)
    }
    if (input.reconnect && response.status === 400) {
      return await sendRelayAssignment({ ...input, reconnect: false }, gate, rateKey)
    }
    throw new RelayHttpError('assignment', response.status, retryAfterMs)
  }
  const parsed = AssignmentResponseSchema.safeParse(await response.json())
  // An out-of-pin cell is a bad director answer: fail it like any 5xx so the caller backs off and retries.
  if (
    !parsed.success ||
    !isPinnedHostRelayCell(input.directorUrl, parsed.data.cellUrl, input.allowedCellOrigins)
  ) {
    throw new RelayHttpError('assignment', 502)
  }
  return parsed.data
}
