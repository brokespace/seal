import type { SealMcpService } from './seal-mcp-service'

let instance: SealMcpService | null = null
const waiting = new Set<(service: SealMcpService) => void>()

/** The running MCP server; null until the host process has installed it and it has loaded. */
export function getSealMcpService(): SealMcpService | null {
  return instance
}

export function setSealMcpService(service: SealMcpService | null): void {
  instance = service
  if (service) {
    for (const listener of waiting) {
      listener(service)
    }
    waiting.clear()
  }
}

/** Calls back once the MCP server is running, at once if it already is. Returns a cancel. */
export function whenSealMcpServiceRuns(listener: (service: SealMcpService) => void): () => void {
  if (instance) {
    listener(instance)
    return () => {}
  }
  waiting.add(listener)
  return () => waiting.delete(listener)
}

export function requireSealMcpService(): SealMcpService {
  if (!instance) {
    throw new Error('The Seal MCP server is not available on this host')
  }
  return instance
}
