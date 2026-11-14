import { sessionRecapViewSchema } from '../../../../src/shared/session-recap/session-recap-schemas'
import type {
  RecapItemMark,
  SessionRecapView
} from '../../../../src/shared/session-recap/session-recap-types'
import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import type { UnvalidatedRpcRequestPort } from '../../transport/rpc/unvalidated-rpc-request-port'

const getRecap = defineRpcOperation({
  name: 'session-recap.get',
  method: 'sessionRecap.get',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('recap', sessionRecapViewSchema)
})

const refreshRecap = defineRpcOperation({
  name: 'session-recap.refresh',
  method: 'sessionRecap.refresh',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('recap', sessionRecapViewSchema)
})

const markRecapItem = defineRpcOperation({
  name: 'session-recap.mark',
  method: 'sessionRecap.mark',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('recap', sessionRecapViewSchema)
})

type Port = UnvalidatedRpcRequestPort

/** A rebuild reads up to three chunks, each one model call that may be retried once. */
const REFRESH_TIMEOUT_MS = 6 * 60_000

/** `look` is the user opening the session: the host counts a visit and updates a stale recap. */
export function readSessionRecap(
  client: Port,
  sessionId: string,
  look: boolean
): Promise<SessionRecapView> {
  return runRpcOperation(client, getRecap, { sessionId, look })
}

export function refreshSessionRecap(client: Port, sessionId: string): Promise<SessionRecapView> {
  return runRpcOperation(client, refreshRecap, { sessionId }, { timeoutMs: REFRESH_TIMEOUT_MS })
}

export function markSessionRecapItem(
  client: Port,
  mark: { sessionId: string; itemId: string; mark: RecapItemMark | null }
): Promise<SessionRecapView> {
  return runRpcOperation(client, markRecapItem, mark)
}
