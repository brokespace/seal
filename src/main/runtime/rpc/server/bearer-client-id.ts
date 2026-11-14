import type { RpcRequest } from '../core'

/**
 * Shipped phones name themselves by their bearer token (terminal `client.id`, subscription ids).
 * Handlers key state by that name and announce it to other paired devices, so every occurrence
 * in a request's params becomes the device's non-secret id before dispatch.
 */
export function withoutBearerClientId(
  request: RpcRequest,
  rawMessage: string,
  bearer: string,
  clientId: string
): RpcRequest {
  // Cheap gate: most requests carry the bearer at most once, as the envelope's own credential.
  const first = rawMessage.indexOf(bearer)
  if (
    request.params === undefined ||
    first === -1 ||
    (hasEnvelopeToken(request) && !rawMessage.includes(bearer, first + bearer.length))
  ) {
    return request
  }
  const params = JSON.stringify(request.params)
  if (!params.includes(bearer)) {
    return request
  }
  const escapedClientId = JSON.stringify(clientId).slice(1, -1)
  return { ...request, params: JSON.parse(params.replaceAll(bearer, () => escapedClientId)) }
}

function hasEnvelopeToken(request: RpcRequest): boolean {
  return typeof (request as Record<string, unknown>).deviceToken === 'string'
}
