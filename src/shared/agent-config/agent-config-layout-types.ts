import type {
  AgentConfigAgentId,
  AgentConfigDocKind,
  AgentConfigFileFormat,
  AgentConfigValidationKind
} from './agent-config-types'

export type AgentConfigCollection = {
  kind: Exclude<AgentConfigDocKind, 'instructions'>
  /** Folder under the scope root (the home folder, or the project root). */
  dir: string
  /** `skill-folders` holds `<name>/SKILL.md`; `files` holds one document per file. */
  shape: 'skill-folders' | 'files'
  extension: string
  /** Sub-folders hold documents too; for skills, a skill folder may sit inside a grouping folder. */
  recursive: boolean
  /** Another agent's folder that this one reads too; listed only when it holds something. */
  shared?: boolean
}

/** Skills the agent loads besides the folders of its account and project. */
export type AgentConfigSkillSources = {
  /** Folders under the home folder with the skills that ship with the agent. */
  builtinDirs: string[]
  /** Whose plugin registry says which plugins, and so which of their skills, are installed. */
  plugins: 'claude' | 'codex' | 'cursor' | null
  /** How the agent's settings switch one skill off. */
  switch: 'claude-overrides' | 'codex-config' | null
}

export type AgentConfigFileSpec = {
  id: string
  /** Path under the scope root. */
  path: string
  format: AgentConfigFileFormat
  validation: AgentConfigValidationKind
  /** Project files only: `local` marks this user's untracked overrides. */
  local?: boolean
}

export type AgentConfigMcpCodec = 'claude' | 'codex' | 'gemini' | 'opencode' | 'generic'

export type AgentConfigMcpSpec = {
  /** File under the scope root. */
  path: string
  codec: AgentConfigMcpCodec
  /** Where the servers map sits inside the file. */
  serversPath: string[]
}

export type AgentConfigScopeLayout = {
  /** The agent's own folder under the scope root; the raw file browser opens here. */
  dir: string
  instructions: string[]
  collections: AgentConfigCollection[]
  files: AgentConfigFileSpec[]
  mcp: AgentConfigMcpSpec | null
}

export type AgentConfigProjectLayout = AgentConfigScopeLayout & {
  /** File names looked for in sub-folders of the project. */
  nestedInstructions: string[]
  /** This user's untracked instruction files at the project root. */
  localInstructions: string[]
}

export type AgentConfigLayout = {
  id: AgentConfigAgentId
  label: string
  /** CLI name, to tell whether the agent is installed. */
  command: string
  user: AgentConfigScopeLayout
  project: AgentConfigProjectLayout
  skills: AgentConfigSkillSources
  features: { claudeSettings: boolean; plugins: boolean; codexConfig: boolean }
}
