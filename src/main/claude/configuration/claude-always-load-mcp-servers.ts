import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { resolveClaudeGlobalConfigFile, toClaudeTrustKey } from './claude-folder-trust-file'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** User and local scope servers Claude would hold start-up for, restated without `alwaysLoad`.
 *  Env-bearing servers are left alone: SDK servers reach the CLI on its command line. */
export function claudeAlwaysLoadMcpServers(
  config: unknown,
  projectKey: string
): Record<string, McpStdioServerConfig> {
  if (!isRecord(config)) {
    return {}
  }
  const project = isRecord(config.projects) ? config.projects[projectKey] : undefined
  const local = isRecord(project) && isRecord(project.mcpServers) ? project.mcpServers : {}
  const disabled =
    isRecord(project) && Array.isArray(project.disabledMcpServers) ? project.disabledMcpServers : []
  // Local scope replaces a user server of the same name.
  const servers = { ...(isRecord(config.mcpServers) ? config.mcpServers : {}), ...local }
  const restated: Record<string, McpStdioServerConfig> = {}
  for (const [name, entry] of Object.entries(servers)) {
    if (
      !isRecord(entry) ||
      entry.alwaysLoad !== true ||
      (entry.type !== undefined && entry.type !== 'stdio') ||
      typeof entry.command !== 'string' ||
      (entry.env !== undefined && (!isRecord(entry.env) || Object.keys(entry.env).length > 0)) ||
      disabled.includes(name)
    ) {
      continue
    }
    const args = Array.isArray(entry.args)
      ? entry.args.filter((arg) => typeof arg === 'string')
      : []
    restated[name] = {
      type: 'stdio',
      command: entry.command,
      ...(args.length > 0 ? { args } : {}),
      ...(typeof entry.timeout === 'number' ? { timeout: entry.timeout } : {})
    }
  }
  return restated
}

/** Reads the global config the child will load; unreadable config restates nothing. */
export async function readClaudeAlwaysLoadMcpServers(
  env: Record<string, string>,
  cwd: string,
  platform: NodeJS.Platform = process.platform
): Promise<Record<string, McpStdioServerConfig>> {
  const style = platform === 'win32' ? 'win32' : 'posix'
  const homeDir = (style === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
  // Claude's legacy file wins when present; probe it without blocking the loop.
  const [legacy, current] = [true, false].map((exists) =>
    resolveClaudeGlobalConfigFile({ env, homeDir, style, exists: () => exists })
  )
  for (const configFile of [legacy, current]) {
    try {
      const config: unknown = JSON.parse(await readFile(configFile, 'utf8'))
      return claudeAlwaysLoadMcpServers(config, toClaudeTrustKey(cwd, style))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        return {}
      }
    }
  }
  return {}
}
