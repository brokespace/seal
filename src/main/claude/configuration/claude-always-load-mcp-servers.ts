import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { McpStdioServerConfig, Options } from '@anthropic-ai/claude-agent-sdk'
import { resolveClaudeGlobalConfigFile, toClaudeTrustKey } from './claude-folder-trust-file'

// Fresh headless Claude spawns SessionStart hooks before noting its input streams; an `alwaysLoad`
// wait widens that window, so an `asyncRewake` hook runs in the foreground and blocks initialize.

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
    const { alwaysLoad: _alwaysLoad, env: _env, ...rest } = entry
    restated[name] = { ...rest, command: entry.command } as McpStdioServerConfig
  }
  return restated
}

/** Reads the global config the child will load; unreadable config restates nothing. */
async function readClaudeAlwaysLoadMcpServers(
  env: Record<string, string>,
  cwd: string,
  platform: NodeJS.Platform = process.platform
): Promise<Record<string, McpStdioServerConfig>> {
  const style = platform === 'win32' ? 'win32' : 'posix'
  const configFile = resolveClaudeGlobalConfigFile({
    env,
    homeDir: (style === 'win32' ? env.USERPROFILE : env.HOME) || homedir(),
    style,
    exists: existsSync
  })
  try {
    const config: unknown = JSON.parse(await readFile(configFile, 'utf8'))
    return claudeAlwaysLoadMcpServers(config, toClaudeTrustKey(cwd, style))
  } catch {
    return {}
  }
}

/** Resumes start hooks after reading their input; only fresh starts that load user hooks race. */
export async function restateClaudeAlwaysLoadMcpServers<
  TOptions extends Pick<Options, 'resume' | 'continue' | 'settingSources' | 'mcpServers'>
>(options: TOptions, env: Record<string, string>, cwd: string): Promise<TOptions> {
  if (
    options.resume !== undefined ||
    options.continue === true ||
    !options.settingSources?.includes('user')
  ) {
    return options
  }
  const restated = await readClaudeAlwaysLoadMcpServers(env, cwd)
  return Object.keys(restated).length > 0
    ? { ...options, mcpServers: { ...restated, ...options.mcpServers } }
    : options
}
