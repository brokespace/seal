import type { MachineId } from '../machines/machine-types'

export type AgentConnectorAgent = 'claude' | 'codex'

/** Where the agent got the server from; claude.ai connectors are managed on claude.ai. */
export type AgentConnectorKind = 'claude-ai' | 'plugin' | 'user' | 'project'

/** `configured` means the agent lists it but did not health-check it (Codex does not). */
export type AgentConnectorStatus = 'connected' | 'needs-auth' | 'failed' | 'disabled' | 'configured'

export type AgentConnector = {
  name: string
  kind: AgentConnectorKind
  transport: 'http' | 'sse' | 'stdio' | null
  /** URL without query or credentials, or the command with secret-looking arguments masked. */
  target: string
  status: AgentConnectorStatus
  /** The agent's own words about the status, such as the connect error. */
  detail: string | null
}

export type AgentConnectorKeepReason = 'connected' | 'claude-ai' | 'original'

/** Connectors in one account that reach the same service; nothing is removed for the user. */
export type AgentConnectorDuplicateGroup = {
  service: string
  names: string[]
  keep: string
  reason: AgentConnectorKeepReason
}

export type AgentConnectorAccount = {
  /** Opaque: `<agent>:default` or `<agent>:<profile id>`; the main process maps it to a config dir. */
  id: string
  agent: AgentConnectorAgent
  label: string
  email: string | null
  /** The agent's own config dir (`~/.claude`, `~/.codex`) rather than a Seal account profile. */
  isDefault: boolean
  connectors: AgentConnector[]
  duplicates: AgentConnectorDuplicateGroup[]
  /** `disableClaudeAiConnectors` is set in this account's Claude settings. */
  claudeAiConnectorsDisabled: boolean
  error: string | null
  checkedAt: number
}

export type AgentConnectorsSnapshot = {
  machineId: MachineId
  accounts: AgentConnectorAccount[]
  checkedAt: number
}

export type AgentConnectorSignInResult = { ok: boolean; message: string | null }

/** `finished` when the CLI ended before printing a page to open (already signed in, or failed). */
export type AgentConnectorSignInStart =
  | { kind: 'url'; sessionId: string; url: string }
  | { kind: 'finished'; result: AgentConnectorSignInResult }

export const AGENT_CONNECTORS_IPC = {
  list: 'agentConnectors:list',
  signInStart: 'agentConnectors:signInStart',
  signInSubmit: 'agentConnectors:signInSubmit',
  signInWait: 'agentConnectors:signInWait',
  signInCancel: 'agentConnectors:signInCancel'
} as const
