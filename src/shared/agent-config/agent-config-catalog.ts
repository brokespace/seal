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
  recursive: boolean
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
  features: { claudeSettings: boolean; plugins: boolean; codexConfig: boolean }
}

const NO_FEATURES = { claudeSettings: false, plugins: false, codexConfig: false }

function skills(dir: string): AgentConfigCollection {
  return { kind: 'skill', dir, shape: 'skill-folders', extension: '.md', recursive: false }
}

function documents(
  kind: AgentConfigCollection['kind'],
  dir: string,
  extension = '.md'
): AgentConfigCollection {
  return { kind, dir, shape: 'files', extension, recursive: true }
}

function json(
  id: string,
  path: string,
  validation: AgentConfigValidationKind = 'json'
): AgentConfigFileSpec {
  return { id, path, format: 'json', validation }
}

/** Gemini CLI and its forks share one layout under a different folder and instruction file. */
function geminiLike(
  id: AgentConfigAgentId,
  label: string,
  command: string,
  dir: string,
  instructionFile: string
): AgentConfigLayout {
  const scope = (prefix: string): AgentConfigScopeLayout => ({
    dir,
    instructions: [`${prefix}${instructionFile}`],
    collections: [skills(`${dir}/skills`), documents('command', `${dir}/commands`, '.toml')],
    files: [json('settings', `${dir}/settings.json`)],
    mcp: { path: `${dir}/settings.json`, codec: 'gemini', serversPath: ['mcpServers'] }
  })
  return {
    id,
    label,
    command,
    user: scope(`${dir}/`),
    project: { ...scope(''), nestedInstructions: [instructionFile], localInstructions: [] },
    features: NO_FEATURES
  }
}

export const AGENT_CONFIG_LAYOUTS: readonly AgentConfigLayout[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    command: 'claude',
    user: {
      dir: '.claude',
      instructions: ['.claude/CLAUDE.md'],
      collections: [
        skills('.claude/skills'),
        documents('subagent', '.claude/agents'),
        documents('command', '.claude/commands')
      ],
      files: [
        json('settings', '.claude/settings.json', 'claude-settings'),
        json('claude-json', '.claude.json')
      ],
      mcp: { path: '.claude.json', codec: 'claude', serversPath: ['mcpServers'] }
    },
    project: {
      dir: '.claude',
      instructions: ['CLAUDE.md', '.claude/CLAUDE.md'],
      nestedInstructions: ['CLAUDE.md'],
      localInstructions: ['CLAUDE.local.md'],
      collections: [
        skills('.claude/skills'),
        documents('subagent', '.claude/agents'),
        documents('command', '.claude/commands')
      ],
      files: [
        json('settings', '.claude/settings.json', 'claude-settings'),
        {
          ...json('settings-local', '.claude/settings.local.json', 'claude-settings'),
          local: true
        },
        json('mcp', '.mcp.json', 'mcp-json')
      ],
      mcp: { path: '.mcp.json', codec: 'claude', serversPath: ['mcpServers'] }
    },
    features: { claudeSettings: true, plugins: true, codexConfig: false }
  },
  {
    id: 'codex',
    label: 'Codex',
    command: 'codex',
    user: {
      dir: '.codex',
      instructions: ['.codex/AGENTS.md', '.codex/AGENTS.override.md'],
      collections: [
        skills('.codex/skills'),
        skills('.agents/skills'),
        documents('prompt', '.codex/prompts')
      ],
      files: [
        { id: 'config', path: '.codex/config.toml', format: 'toml', validation: 'codex-config' }
      ],
      mcp: { path: '.codex/config.toml', codec: 'codex', serversPath: ['mcp_servers'] }
    },
    project: {
      dir: '.codex',
      instructions: ['AGENTS.md', 'AGENTS.override.md'],
      nestedInstructions: ['AGENTS.md', 'AGENTS.override.md'],
      localInstructions: [],
      collections: [skills('.codex/skills'), skills('.agents/skills')],
      files: [
        { id: 'config', path: '.codex/config.toml', format: 'toml', validation: 'codex-config' }
      ],
      mcp: { path: '.codex/config.toml', codec: 'codex', serversPath: ['mcp_servers'] }
    },
    features: { claudeSettings: false, plugins: false, codexConfig: true }
  },
  geminiLike('gemini', 'Gemini CLI', 'gemini', '.gemini', 'GEMINI.md'),
  geminiLike('qwen-code', 'Qwen Code', 'qwen', '.qwen', 'QWEN.md'),
  {
    id: 'opencode',
    label: 'OpenCode',
    command: 'opencode',
    user: {
      dir: '.config/opencode',
      instructions: ['.config/opencode/AGENTS.md'],
      collections: [
        skills('.config/opencode/skills'),
        documents('subagent', '.config/opencode/agent'),
        documents('subagent', '.config/opencode/agents'),
        documents('command', '.config/opencode/command'),
        documents('command', '.config/opencode/commands')
      ],
      files: [json('config', '.config/opencode/opencode.json', 'jsonc')],
      mcp: { path: '.config/opencode/opencode.json', codec: 'opencode', serversPath: ['mcp'] }
    },
    project: {
      dir: '.opencode',
      instructions: ['AGENTS.md'],
      nestedInstructions: ['AGENTS.md'],
      localInstructions: [],
      collections: [
        skills('.opencode/skills'),
        documents('subagent', '.opencode/agent'),
        documents('subagent', '.opencode/agents'),
        documents('command', '.opencode/command'),
        documents('command', '.opencode/commands')
      ],
      files: [json('config', 'opencode.json', 'jsonc')],
      mcp: { path: 'opencode.json', codec: 'opencode', serversPath: ['mcp'] }
    },
    features: NO_FEATURES
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'cursor-agent',
    user: {
      dir: '.cursor',
      instructions: [],
      collections: [skills('.cursor/skills'), documents('command', '.cursor/commands')],
      files: [json('mcp', '.cursor/mcp.json', 'mcp-json'), json('cli', '.cursor/cli-config.json')],
      mcp: { path: '.cursor/mcp.json', codec: 'generic', serversPath: ['mcpServers'] }
    },
    project: {
      dir: '.cursor',
      instructions: ['AGENTS.md'],
      nestedInstructions: ['AGENTS.md'],
      localInstructions: [],
      collections: [
        skills('.cursor/skills'),
        documents('rule', '.cursor/rules', '.mdc'),
        documents('command', '.cursor/commands')
      ],
      files: [json('mcp', '.cursor/mcp.json', 'mcp-json')],
      mcp: { path: '.cursor/mcp.json', codec: 'generic', serversPath: ['mcpServers'] }
    },
    features: NO_FEATURES
  },
  {
    id: 'droid',
    label: 'Droid',
    command: 'droid',
    user: {
      dir: '.factory',
      instructions: ['.factory/AGENTS.md'],
      collections: [
        skills('.factory/skills'),
        documents('subagent', '.factory/droids'),
        documents('command', '.factory/commands')
      ],
      files: [
        json('settings', '.factory/settings.json'),
        json('mcp', '.factory/mcp.json', 'mcp-json')
      ],
      mcp: { path: '.factory/mcp.json', codec: 'generic', serversPath: ['mcpServers'] }
    },
    project: {
      dir: '.factory',
      instructions: ['AGENTS.md'],
      nestedInstructions: ['AGENTS.md'],
      localInstructions: [],
      collections: [
        skills('.factory/skills'),
        documents('subagent', '.factory/droids'),
        documents('command', '.factory/commands')
      ],
      files: [json('mcp', '.factory/mcp.json', 'mcp-json')],
      mcp: { path: '.factory/mcp.json', codec: 'generic', serversPath: ['mcpServers'] }
    },
    features: NO_FEATURES
  },
  {
    id: 'amp',
    label: 'Amp',
    command: 'amp',
    user: {
      dir: '.config/amp',
      instructions: ['.config/amp/AGENTS.md'],
      collections: [skills('.config/agents/skills'), documents('command', '.config/amp/commands')],
      files: [json('settings', '.config/amp/settings.json')],
      mcp: { path: '.config/amp/settings.json', codec: 'generic', serversPath: ['amp.mcpServers'] }
    },
    project: {
      dir: '.agents',
      instructions: ['AGENTS.md'],
      nestedInstructions: ['AGENTS.md'],
      localInstructions: [],
      collections: [skills('.agents/skills'), documents('command', '.agents/commands')],
      files: [json('settings', '.amp/settings.json')],
      mcp: { path: '.amp/settings.json', codec: 'generic', serversPath: ['amp.mcpServers'] }
    },
    features: NO_FEATURES
  }
]

const LAYOUT_BY_ID = new Map(AGENT_CONFIG_LAYOUTS.map((layout) => [layout.id, layout]))

export function isAgentConfigAgentId(value: unknown): value is AgentConfigAgentId {
  return AGENT_CONFIG_LAYOUTS.some((layout) => layout.id === value)
}

export function agentConfigLayout(agent: AgentConfigAgentId): AgentConfigLayout {
  const layout = LAYOUT_BY_ID.get(agent)
  if (!layout) {
    throw new Error(`Seal has no configuration layout for "${agent}"`)
  }
  return layout
}

/** Folders and file names that are never part of a project's own instructions. */
export const AGENT_CONFIG_NESTED_SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'vendor',
  'target',
  '.venv',
  '.next',
  '.cache'
]

/** How deep under a project root nested instruction files are looked for. */
export const AGENT_CONFIG_NESTED_MAX_DEPTH = 6
