import type {
  AgentConfigCollection,
  AgentConfigFileSpec,
  AgentConfigLayout,
  AgentConfigScopeLayout,
  AgentConfigSkillSources
} from './agent-config-layout-types'
import type { AgentConfigAgentId, AgentConfigValidationKind } from './agent-config-types'

const NO_FEATURES = { claudeSettings: false, plugins: false, codexConfig: false }
const OWN_SKILLS_ONLY: AgentConfigSkillSources = { builtinDirs: [], plugins: null, switch: null }

function skills(
  dir: string,
  options: { recursive?: boolean; shared?: boolean } = {}
): AgentConfigCollection {
  return {
    kind: 'skill',
    dir,
    shape: 'skill-folders',
    extension: '.md',
    recursive: options.recursive === true,
    ...(options.shared ? { shared: true } : {})
  }
}

/** A folder of another agent that this agent reads skills from as well. */
function sharedSkills(dir: string): AgentConfigCollection {
  return skills(dir, { shared: true })
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
  instructionFile: string,
  sharedSkillDirs: string[] = []
): AgentConfigLayout {
  const scope = (prefix: string): AgentConfigScopeLayout => ({
    dir,
    instructions: [`${prefix}${instructionFile}`],
    collections: [
      skills(`${dir}/skills`),
      ...sharedSkillDirs.map(sharedSkills),
      documents('command', `${dir}/commands`, '.toml')
    ],
    files: [json('settings', `${dir}/settings.json`)],
    mcp: { path: `${dir}/settings.json`, codec: 'gemini', serversPath: ['mcpServers'] }
  })
  return {
    id,
    label,
    command,
    user: scope(`${dir}/`),
    project: { ...scope(''), nestedInstructions: [instructionFile], localInstructions: [] },
    skills: OWN_SKILLS_ONLY,
    features: NO_FEATURES
  }
}

const OPENCODE_BORROWED = ['.agents/skills', '.claude/skills'].map(sharedSkills)
const CURSOR_BORROWED = ['.agents/skills', '.claude/skills', '.codex/skills'].map(sharedSkills)

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
    skills: { builtinDirs: [], plugins: 'claude', switch: 'claude-overrides' },
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
        skills('.codex/skills', { recursive: true }),
        skills('.agents/skills', { recursive: true }),
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
      collections: [
        skills('.codex/skills', { recursive: true }),
        skills('.agents/skills', { recursive: true })
      ],
      files: [
        { id: 'config', path: '.codex/config.toml', format: 'toml', validation: 'codex-config' }
      ],
      mcp: { path: '.codex/config.toml', codec: 'codex', serversPath: ['mcp_servers'] }
    },
    skills: { builtinDirs: ['.codex/skills/.system'], plugins: 'codex', switch: 'codex-config' },
    features: { claudeSettings: false, plugins: false, codexConfig: true }
  },
  geminiLike('gemini', 'Gemini CLI', 'gemini', '.gemini', 'GEMINI.md', ['.agents/skills']),
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
        ...OPENCODE_BORROWED,
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
        ...OPENCODE_BORROWED,
        documents('subagent', '.opencode/agent'),
        documents('subagent', '.opencode/agents'),
        documents('command', '.opencode/command'),
        documents('command', '.opencode/commands')
      ],
      files: [json('config', 'opencode.json', 'jsonc')],
      mcp: { path: 'opencode.json', codec: 'opencode', serversPath: ['mcp'] }
    },
    skills: OWN_SKILLS_ONLY,
    features: NO_FEATURES
  },
  {
    id: 'cursor',
    label: 'Cursor',
    command: 'cursor-agent',
    user: {
      dir: '.cursor',
      instructions: [],
      collections: [
        skills('.cursor/skills'),
        ...CURSOR_BORROWED,
        documents('command', '.cursor/commands')
      ],
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
        ...CURSOR_BORROWED,
        documents('rule', '.cursor/rules', '.mdc'),
        documents('command', '.cursor/commands')
      ],
      files: [json('mcp', '.cursor/mcp.json', 'mcp-json')],
      mcp: { path: '.cursor/mcp.json', codec: 'generic', serversPath: ['mcpServers'] }
    },
    skills: { builtinDirs: ['.cursor/skills-cursor'], plugins: 'cursor', switch: null },
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
    skills: OWN_SKILLS_ONLY,
    features: NO_FEATURES
  },
  {
    id: 'amp',
    label: 'Amp',
    command: 'amp',
    user: {
      dir: '.config/amp',
      instructions: ['.config/amp/AGENTS.md'],
      collections: [
        skills('.config/agents/skills'),
        sharedSkills('.claude/skills'),
        documents('command', '.config/amp/commands')
      ],
      files: [json('settings', '.config/amp/settings.json')],
      mcp: { path: '.config/amp/settings.json', codec: 'generic', serversPath: ['amp.mcpServers'] }
    },
    project: {
      dir: '.agents',
      instructions: ['AGENTS.md'],
      nestedInstructions: ['AGENTS.md'],
      localInstructions: [],
      collections: [
        skills('.agents/skills'),
        sharedSkills('.claude/skills'),
        documents('command', '.agents/commands')
      ],
      files: [json('settings', '.amp/settings.json')],
      mcp: { path: '.amp/settings.json', codec: 'generic', serversPath: ['amp.mcpServers'] }
    },
    skills: OWN_SKILLS_ONLY,
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
