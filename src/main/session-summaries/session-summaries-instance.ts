import type { SessionSummariesHost } from './session-summaries-host'

let installed: SessionSummariesHost | null = null

export function setSessionSummariesHost(host: SessionSummariesHost | null): void {
  installed = host
}

export function getSessionSummariesHost(): SessionSummariesHost | null {
  return installed
}

export function requireSessionSummariesHost(): SessionSummariesHost {
  if (!installed) {
    throw new Error('Session summaries are not available in this runtime.')
  }
  return installed
}

/** A pane agent's summary on this host, for the agent rows clients read; null when it has none. */
export function paneStatusSummary(paneKey: string): string | null {
  return installed?.paneSummary(paneKey) ?? null
}
