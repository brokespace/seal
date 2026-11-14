import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

/** Long enough for a tool call that waits on approval and then runs a long command. */
export const SEAL_MCP_TOOL_CALL_TIMEOUT_MS = 30 * 60_000

type JsonRpcMessage = Record<string, unknown>

export type SealMcpStdioBridgeOptions = {
  input: Readable
  output: Writable
  /** Hands one JSON-RPC message to the Seal server; resolves to its reply, or null for none. */
  send: (message: JsonRpcMessage) => Promise<JsonRpcMessage | null>
  /** Diagnostics. Stdout carries protocol frames only, so these go to stderr. */
  log: (line: string) => void
}

function isRecord(value: unknown): value is JsonRpcMessage {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function failure(id: unknown, code: number, message: string): JsonRpcMessage {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

/**
 * MCP's stdio transport as a pipe: one JSON-RPC message per line in, one per line out. The Seal
 * server answers every message, so this process holds no tools, scopes or state of its own.
 */
export async function runSealMcpStdioBridge(options: SealMcpStdioBridgeOptions): Promise<void> {
  const { output, send, log } = options
  const inFlight = new Set<Promise<void>>()
  const write = (message: JsonRpcMessage): void => {
    output.write(`${JSON.stringify(message)}\n`)
  }
  const relay = async (message: unknown): Promise<void> => {
    if (!isRecord(message)) {
      write(failure(null, -32_600, 'Not a JSON-RPC message.'))
      return
    }
    try {
      const reply = await send(message)
      if (reply) {
        write(reply)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      log(`seal mcp: ${reason}`)
      // A notification has no reply to carry the failure.
      if (message.id !== undefined) {
        write(failure(message.id, -32_000, reason))
      }
    }
  }
  for await (const line of createInterface({ input: options.input, crlfDelay: Infinity })) {
    if (!line.trim()) {
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      write(failure(null, -32_700, 'Parse error.'))
      continue
    }
    // Calls run side by side so a ping is answered while a tool call waits on approval.
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      const work = relay(message).finally(() => inFlight.delete(work))
      inFlight.add(work)
    }
  }
  await Promise.all(inFlight)
}
