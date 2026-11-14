import type { MachineId } from '../machines/machine-types'

/** Agents whose configuration Seal can manage; the catalog describes where each keeps it. */
export type AgentConfigAgentId =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'qwen-code'
  | 'opencode'
  | 'cursor'
  | 'droid'
  | 'amp'

/** `user` is the machine-wide config, `project` is checked in, `local` is this user's project overrides. */
export type AgentConfigScope = 'user' | 'project' | 'local'

export type AgentConfigTarget = {
  machineId: MachineId
  agent: AgentConfigAgentId
  /** Absolute project root on that machine; absent for the machine-wide config. */
  projectPath?: string
}

export type AgentConfigDocKind =
  | 'instructions'
  | 'skill'
  | 'subagent'
  | 'command'
  | 'prompt'
  | 'rule'

export type AgentConfigIssue = {
  severity: 'error' | 'warning'
  message: string
  field?: string
}

export type AgentConfigDocRef = {
  kind: AgentConfigDocKind
  scope: AgentConfigScope
  name: string
  description: string
  /** The markdown file; `SKILL.md` for a skill. */
  path: string
  /** A skill's folder: the unit that is duplicated, renamed, deleted and copied. */
  directory: string | null
  bytes: number
  /** Position under the project root, for nested instruction files. */
  relativePath?: string
  issues: AgentConfigIssue[]
}

export type AgentConfigFileFormat = 'json' | 'toml' | 'markdown' | 'text'

export type AgentConfigFileRef = {
  id: string
  label: string
  scope: AgentConfigScope
  path: string
  format: AgentConfigFileFormat
  exists: boolean
  bytes: number
  /** Why the file on disk does not parse. */
  error?: string
}

/** One scope's copy of the agent's main settings file: `settings.json`, `config.toml`, `opencode.json`. */
export type AgentConfigSettingsLayer = {
  scope: AgentConfigScope
  path: string
  format: 'json' | 'toml'
  exists: boolean
  error?: string
  /** Parsed settings without the MCP servers; secret-looking values are replaced by the mask. */
  value: Record<string, unknown> | null
  maskedPaths: string[]
}

export type AgentConfigMcpTransport = 'stdio' | 'http' | 'sse'

/** How a project-file server stands with this user: Claude asks before using `.mcp.json` servers. */
export type AgentConfigMcpActivation = 'approved' | 'disabled' | 'pending'

export type AgentConfigMcpServer = {
  name: string
  scope: AgentConfigScope
  /** File holding the definition. */
  sourcePath: string
  transport: AgentConfigMcpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  /** Fields whose value is shown masked: `env.KEY`, `headers.Name`, `args.2`, `url`. */
  maskedFields: string[]
  enabled: boolean
  activation?: AgentConfigMcpActivation
  /** Keys in the file that the form does not edit; saving keeps them. */
  extraKeys: string[]
  /** Set when a server in a higher scope with the same name replaces this one. */
  shadowedBy?: AgentConfigScope
  issue?: string
}

/** What the MCP form submits; a value left as the mask keeps the stored secret. */
export type AgentConfigMcpDraft = {
  name: string
  transport: AgentConfigMcpTransport
  command: string
  args: string[]
  env: Record<string, string>
  url: string
  headers: Record<string, string>
  enabled: boolean
}

export type AgentConfigMcpAuth =
  | 'none'
  | 'static-header'
  | 'env-token'
  | 'oauth-signed-in'
  | 'needs-auth'
  | 'unknown'

export type AgentConfigMcpTestResult = {
  status: 'connected' | 'needs-auth' | 'failed' | 'unsupported'
  auth: AgentConfigMcpAuth
  /** One line for the row: the server's own name and version, or why it failed. */
  detail: string
  serverName?: string
  serverVersion?: string
  /** HTTP status for remote servers. */
  httpStatus?: number
  durationMs: number
}

export type AgentConfigPluginInstall = {
  scope: AgentConfigScope
  version: string | null
  installPath: string
  projectPath?: string
  lastUpdated?: string
}

export type AgentConfigPlugin = {
  /** `name@marketplace`, the key Claude Code uses everywhere. */
  id: string
  name: string
  marketplace: string
  description: string
  installs: AgentConfigPluginInstall[]
  /** The `enabledPlugins` entry in each settings file that names this plugin. */
  enabledIn: Partial<Record<AgentConfigScope, boolean>>
  /** Whether Claude Code loads it here once every scope is merged. */
  enabled: boolean
  /** The scope that decided `enabled`. */
  enabledBy: AgentConfigScope | null
}

export type AgentConfigMarketplacePlugin = {
  name: string
  description: string
  version: string | null
  installed: boolean
}

export type AgentConfigMarketplace = {
  name: string
  /** `owner/repo`, a git URL or a folder. */
  source: string
  installLocation: string
  lastUpdated?: string
  plugins: AgentConfigMarketplacePlugin[]
  error?: string
}

export type AgentConfigPluginsState = {
  plugins: AgentConfigPlugin[]
  marketplaces: AgentConfigMarketplace[]
}

export type AgentConfigEffectiveEntry = {
  /** Dotted path of the value, e.g. `permissions.allow` or `env.FOO`. */
  key: string
  /** JSON text of the effective value. */
  value: string
  source: AgentConfigScope
  /** For list values merged across scopes: which scope contributed each item. */
  items?: { value: string; source: AgentConfigScope }[]
  /** Values in lower scopes that this one replaced. */
  overrides: { source: AgentConfigScope; value: string }[]
}

export type AgentConfigSnapshot = {
  target: AgentConfigTarget
  homeDir: string
  /** The agent's own folder for this scope: `~/.claude`, or `<project>/.claude`. */
  agentDir: string
  /** Whether the agent's CLI is on the machine's PATH. */
  cliAvailable: boolean
  docs: AgentConfigDocRef[]
  files: AgentConfigFileRef[]
  settings: AgentConfigSettingsLayer[]
  mcp: AgentConfigMcpServer[]
  plugins: AgentConfigPluginsState | null
  /** The merged view of settings across scopes, with where each value comes from. */
  effective: AgentConfigEffectiveEntry[]
  /** Parts that could not be read, so the page can say so instead of showing them as empty. */
  warnings: string[]
}

export type AgentConfigAgentPresence = {
  agent: AgentConfigAgentId
  label: string
  /** The CLI is on PATH. */
  installed: boolean
  /** Its config folder (or, for a project, any of its project files) exists. */
  configured: boolean
}

export type AgentConfigDocument = {
  path: string
  content: string
  /** Hash of the content as read; sent back on save so a newer file on disk is never overwritten. */
  hash: string
  exists: boolean
}

export type AgentConfigValidationKind =
  | AgentConfigDocKind
  | 'json'
  | 'jsonc'
  | 'claude-settings'
  | 'mcp-json'
  | 'toml'
  | 'codex-config'
  | 'text'

export type AgentConfigWriteResult = {
  path: string
  hash: string
  /** Copy of what was there before; null when the file is new. */
  backupPath: string | null
}

export type AgentConfigJsonEdit =
  | { path: (string | number)[]; value: unknown }
  | { path: (string | number)[]; remove: true }

/** A change to a settings file by key path; the file's format decides how it is applied. */
export type AgentConfigSettingsEdit =
  | { path: string[]; value: unknown }
  | { path: string[]; remove: true }

export type AgentConfigTomlValue =
  | string
  | number
  | boolean
  | AgentConfigTomlValue[]
  | { [key: string]: AgentConfigTomlValue }

export type AgentConfigTomlEdit =
  | { path: string[]; value: AgentConfigTomlValue }
  | { path: string[]; remove: true }

export type AgentConfigPluginCommand =
  | { kind: 'install'; plugin: string; scope: AgentConfigScope }
  | { kind: 'uninstall'; plugin: string; scope: AgentConfigScope }
  | { kind: 'update'; plugin: string; scope: AgentConfigScope }
  | { kind: 'marketplace-add'; source: string }
  | { kind: 'marketplace-remove'; name: string }
  | { kind: 'marketplace-update'; name: string | null }

export type AgentConfigCommandResult = {
  ok: boolean
  /** The command line that ran, for the user to repeat by hand. */
  command: string
  output: string
}

export type AgentConfigBackup = {
  /** The backup copy on the machine. */
  backupPath: string
  /** Where it was taken from. */
  originalPath: string
  takenAt: number
  bytes: number
  isDirectory: boolean
}

export type AgentConfigCopyResult = {
  path: string
  backupPath: string | null
}

/** Shown in place of a secret; a form that sends it back keeps the stored value. */
export const AGENT_CONFIG_SECRET_MASK = '••••••••'

export const AGENT_CONFIG_IPC = {
  agents: 'agentConfig:agents',
  snapshot: 'agentConfig:snapshot',
  readDocument: 'agentConfig:readDocument',
  saveDocument: 'agentConfig:saveDocument',
  createDocument: 'agentConfig:createDocument',
  duplicateDocument: 'agentConfig:duplicateDocument',
  renameDocument: 'agentConfig:renameDocument',
  deleteDocument: 'agentConfig:deleteDocument',
  copyDocument: 'agentConfig:copyDocument',
  saveMcpServer: 'agentConfig:saveMcpServer',
  removeMcpServer: 'agentConfig:removeMcpServer',
  copyMcpServer: 'agentConfig:copyMcpServer',
  revealMcpServer: 'agentConfig:revealMcpServer',
  testMcpServer: 'agentConfig:testMcpServer',
  setMcpActivation: 'agentConfig:setMcpActivation',
  patchSettings: 'agentConfig:patchSettings',
  setPluginEnabled: 'agentConfig:setPluginEnabled',
  runPluginCommand: 'agentConfig:runPluginCommand',
  listBackups: 'agentConfig:listBackups',
  restoreBackup: 'agentConfig:restoreBackup',
  removePaths: 'agentConfig:removePaths',
  renamePath: 'agentConfig:renamePath'
} as const
