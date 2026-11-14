import { validateMarkdownDocument } from './agent-config-frontmatter'
import { parseJsonObject } from './agent-config-json-edit'
import { parseTomlObject } from './agent-config-toml-edit'
import type { AgentConfigIssue, AgentConfigValidationKind } from './agent-config-types'
import { isPlainObject } from './agent-config-values'

function error(message: string, field?: string): AgentConfigIssue {
  return field ? { severity: 'error', message, field } : { severity: 'error', message }
}

function warning(message: string, field?: string): AgentConfigIssue {
  return field ? { severity: 'warning', message, field } : { severity: 'warning', message }
}

function strictJson(content: string): {
  value?: Record<string, unknown>
  issues: AgentConfigIssue[]
} {
  if (content.trim() === '') {
    return { value: {}, issues: [] }
  }
  try {
    const value: unknown = JSON.parse(content)
    return isPlainObject(value)
      ? { value, issues: [] }
      : { issues: [error('The file must hold a JSON object')] }
  } catch (cause) {
    return {
      issues: [error(`Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`)]
    }
  }
}

function isStringList(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const HOOK_EVENTS = new Set([
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'Notification',
  'UserPromptSubmit',
  'Stop',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd'
])

function checkHooks(hooks: unknown, issues: AgentConfigIssue[]): void {
  if (hooks === undefined) {
    return
  }
  if (!isPlainObject(hooks)) {
    issues.push(error('hooks must be an object keyed by event', 'hooks'))
    return
  }
  for (const [event, groups] of Object.entries(hooks)) {
    const field = `hooks.${event}`
    if (!HOOK_EVENTS.has(event)) {
      issues.push(warning(`"${event}" is not a hook event Seal knows`, field))
    }
    if (!Array.isArray(groups)) {
      issues.push(error(`${field} must be a list`, field))
      continue
    }
    for (const group of groups) {
      const commands = isPlainObject(group) ? group.hooks : undefined
      const valid =
        Array.isArray(commands) &&
        commands.every(
          (hook) =>
            isPlainObject(hook) &&
            typeof hook.type === 'string' &&
            (hook.type !== 'command' || (typeof hook.command === 'string' && hook.command !== ''))
        )
      if (!valid) {
        issues.push(error(`Every ${event} entry needs a hooks list of { type, command }`, field))
        break
      }
    }
  }
}

export function validateClaudeSettings(value: Record<string, unknown>): AgentConfigIssue[] {
  const issues: AgentConfigIssue[] = []
  const { permissions, env, model, statusLine, enabledPlugins } = value
  if (permissions !== undefined && !isPlainObject(permissions)) {
    issues.push(error('permissions must be an object', 'permissions'))
  } else if (isPlainObject(permissions)) {
    for (const key of ['allow', 'deny', 'ask', 'additionalDirectories']) {
      if (permissions[key] !== undefined && !isStringList(permissions[key])) {
        issues.push(error(`permissions.${key} must be a list of rules`, `permissions.${key}`))
      }
    }
  }
  if (env !== undefined) {
    const valid = isPlainObject(env) && Object.values(env).every((item) => typeof item === 'string')
    if (!valid) {
      issues.push(error('env must map variable names to text values', 'env'))
    }
  }
  if (model !== undefined && typeof model !== 'string') {
    issues.push(error('model must be text', 'model'))
  }
  if (statusLine !== undefined) {
    const valid =
      isPlainObject(statusLine) &&
      typeof statusLine.type === 'string' &&
      (statusLine.type !== 'command' || typeof statusLine.command === 'string')
    if (!valid) {
      issues.push(error('statusLine must be { "type": "command", "command": "…" }', 'statusLine'))
    }
  }
  if (enabledPlugins !== undefined) {
    const valid =
      isPlainObject(enabledPlugins) &&
      Object.values(enabledPlugins).every((item) => typeof item === 'boolean')
    if (!valid) {
      issues.push(error('enabledPlugins must map plugin ids to true or false', 'enabledPlugins'))
    }
  }
  checkHooks(value.hooks, issues)
  return issues
}

function checkServers(servers: unknown, field: string, issues: AgentConfigIssue[]): void {
  if (servers === undefined) {
    return
  }
  if (!isPlainObject(servers)) {
    issues.push(error(`${field} must be an object keyed by server name`, field))
    return
  }
  for (const [name, entry] of Object.entries(servers)) {
    if (!isPlainObject(entry)) {
      issues.push(error(`Server "${name}" must be a table of settings`, `${field}.${name}`))
    } else if (!entry.command && !entry.url && !entry.httpUrl) {
      issues.push(error(`Server "${name}" has neither a command nor a URL`, `${field}.${name}`))
    }
  }
}

const CODEX_APPROVALS = ['untrusted', 'on-failure', 'on-request', 'never']
const CODEX_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']

export function validateCodexConfig(value: Record<string, unknown>): AgentConfigIssue[] {
  const issues: AgentConfigIssue[] = []
  const scalar = (key: string, allowed?: readonly string[]): void => {
    const item = value[key]
    if (item === undefined) {
      return
    }
    if (typeof item !== 'string') {
      // Newer Codex accepts a table for some policies; Seal only knows the named ones.
      issues.push(warning(`${key} is not one of the values Seal knows`, key))
    } else if (allowed && !allowed.includes(item)) {
      issues.push(warning(`${key} = "${item}" is not one of: ${allowed.join(', ')}`, key))
    }
  }
  scalar('model')
  scalar('approval_policy', CODEX_APPROVALS)
  scalar('sandbox_mode', CODEX_SANDBOXES)
  if (value.profiles !== undefined) {
    const valid =
      isPlainObject(value.profiles) && Object.values(value.profiles).every(isPlainObject)
    if (!valid) {
      issues.push(error('profiles must be tables: [profiles.<name>]', 'profiles'))
    }
  }
  checkServers(value.mcp_servers, 'mcp_servers', issues)
  return issues
}

/** What is wrong with a file's new content; an error stops the write. */
export function validateAgentConfigContent(
  kind: AgentConfigValidationKind,
  content: string,
  expectedName?: string
): AgentConfigIssue[] {
  switch (kind) {
    case 'json':
      return strictJson(content).issues
    case 'jsonc': {
      const parsed = parseJsonObject(content)
      return parsed.ok ? [] : [error(`Not valid JSON: ${parsed.error}`)]
    }
    case 'claude-settings': {
      const parsed = strictJson(content)
      return parsed.value ? validateClaudeSettings(parsed.value) : parsed.issues
    }
    case 'mcp-json': {
      const parsed = strictJson(content)
      if (!parsed.value) {
        return parsed.issues
      }
      const issues: AgentConfigIssue[] = []
      checkServers(parsed.value.mcpServers, 'mcpServers', issues)
      return issues
    }
    case 'toml':
    case 'codex-config': {
      const parsed = parseTomlObject(content)
      if (!parsed.ok) {
        return [error(`Not valid TOML: ${parsed.error}`)]
      }
      return kind === 'codex-config' ? validateCodexConfig(parsed.value) : []
    }
    case 'text':
      return []
    case 'instructions':
    case 'skill':
    case 'subagent':
    case 'command':
    case 'prompt':
    case 'rule':
      return validateMarkdownDocument(kind, content, expectedName)
  }
}

/** The check a path gets when the caller names none: by its name and place, then its extension. */
export function validationKindForPath(path: string): AgentConfigValidationKind {
  const normalized = path.replaceAll('\\', '/')
  const name = normalized.split('/').at(-1) ?? ''
  if (name === 'SKILL.md') {
    return 'skill'
  }
  if (/\/\.claude\/settings(\.local)?\.json$/.test(normalized)) {
    return 'claude-settings'
  }
  if (name === '.mcp.json' || name === 'mcp.json') {
    return 'mcp-json'
  }
  if (normalized.endsWith('/.codex/config.toml')) {
    return 'codex-config'
  }
  if (name === 'opencode.json' || name.endsWith('.jsonc')) {
    return 'jsonc'
  }
  if (name.endsWith('.json')) {
    return 'json'
  }
  if (name.endsWith('.toml')) {
    return 'toml'
  }
  if (/\/\.claude\/agents\/[^/]+\.md$/.test(normalized)) {
    return 'subagent'
  }
  return 'text'
}
