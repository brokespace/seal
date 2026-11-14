import type { SealMcpService } from './seal-mcp-service'

let instance: SealMcpService | null = null

/** The running MCP server; null until the host process installs it. */
export function getSealMcpService(): SealMcpService | null {
  return instance
}

export function setSealMcpService(service: SealMcpService | null): void {
  instance = service
}

export function requireSealMcpService(): SealMcpService {
  if (!instance) {
    throw new Error('The Seal MCP server is not available on this host')
  }
  return instance
}
