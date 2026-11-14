/** Newest first. A client asking for one of these gets it; any other gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']

export type McpJsonRpcMessage = Record<string, unknown>

export type McpToolAnswer = { text: string; isError: boolean }

export type McpJsonRpcHost = {
  serverInfo: { name: string; title?: string; version: string }
  /** Guidance a client shows its model next to the tools. */
  instructions?: string
  listTools: () => unknown[]
  callTool: (name: string, args: unknown, requestId: string | number) => Promise<McpToolAnswer>
}

export const MCP_PARSE_ERROR = -32700
export const MCP_INVALID_REQUEST = -32600
export const MCP_METHOD_NOT_FOUND = -32601
export const MCP_INVALID_PARAMS = -32602

export const isMcpRecord = (value: unknown): value is McpJsonRpcMessage =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function mcpRequestId(message: McpJsonRpcMessage): string | number | null {
  const { id } = message
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

export function mcpError(
  id: string | number | null,
  code: number,
  message: string
): McpJsonRpcMessage {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function negotiatedVersion(requested: unknown): string {
  return typeof requested === 'string' && MCP_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSIONS[0]
}

/**
 * Answers one MCP JSON-RPC message for a server that offers tools and nothing else. Notifications
 * and replies carry no id to answer, so they return null.
 */
export async function answerMcpRequest(
  request: McpJsonRpcMessage,
  host: McpJsonRpcHost
): Promise<McpJsonRpcMessage | null> {
  const id = mcpRequestId(request)
  const { method } = request
  if (id === null || typeof method !== 'string') {
    return null
  }
  const params = isMcpRecord(request.params) ? request.params : {}
  const result = (value: unknown): McpJsonRpcMessage => ({ jsonrpc: '2.0', id, result: value })
  switch (method) {
    case 'initialize':
      return result({
        protocolVersion: negotiatedVersion(params.protocolVersion),
        capabilities: { tools: {} },
        serverInfo: host.serverInfo,
        ...(host.instructions ? { instructions: host.instructions } : {})
      })
    case 'ping':
      return result({})
    case 'tools/list':
      return result({ tools: host.listTools() })
    case 'tools/call': {
      if (typeof params.name !== 'string') {
        return mcpError(id, MCP_INVALID_PARAMS, 'tools/call needs the name of a tool.')
      }
      const reply = await host.callTool(params.name, params.arguments, id)
      return result({ content: [{ type: 'text', text: reply.text }], isError: reply.isError })
    }
    default:
      return mcpError(id, MCP_METHOD_NOT_FOUND, `Method not found: ${method}`)
  }
}

export type ParsedMcpBody = { messages: McpJsonRpcMessage[]; batch: boolean }

/** A request body is one message or a batch of them; null when it is neither. */
export function parseMcpBody(body: string): ParsedMcpBody | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (Array.isArray(parsed)) {
    return parsed.length > 0 && parsed.every(isMcpRecord) ? { messages: parsed, batch: true } : null
  }
  return isMcpRecord(parsed) ? { messages: [parsed], batch: false } : null
}
