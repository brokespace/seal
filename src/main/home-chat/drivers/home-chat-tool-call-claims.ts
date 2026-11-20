import { randomUUID } from 'node:crypto'
import type { HomeChatTurnRecorder } from '../engine/home-chat-turn-recorder'

const CLAIM_WAIT_MS = 300
const CLAIM_POLL_MS = 25

/**
 * A CLI announces a tool call on its event stream and then asks Seal's MCP server to run it, without
 * telling the server which call it is. Pair the request with the oldest announced call of that tool
 * (same arguments first), waiting briefly for the announcement; an unannounced request gets a new id.
 */
export async function claimToolCall(
  recorder: HomeChatTurnRecorder,
  claimed: Set<string>,
  tool: string,
  input: unknown,
  idPrefix: string
): Promise<string> {
  const wanted = JSON.stringify(input)
  const find = (): string | undefined => {
    const pending = recorder
      .pendingCalls()
      .filter((call) => call.tool === tool && !claimed.has(call.callId))
    return (pending.find((call) => JSON.stringify(call.input) === wanted) ?? pending[0])?.callId
  }
  for (let waited = 0; waited <= CLAIM_WAIT_MS; waited += CLAIM_POLL_MS) {
    const callId = find()
    if (callId) {
      claimed.add(callId)
      return callId
    }
    await new Promise((resolve) => setTimeout(resolve, CLAIM_POLL_MS))
  }
  const callId = `${idPrefix}_${randomUUID()}`
  claimed.add(callId)
  return callId
}
