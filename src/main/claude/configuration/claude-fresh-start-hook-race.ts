import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Options, SettingSource } from '@anthropic-ai/claude-agent-sdk'
import { readClaudeAlwaysLoadMcpServers } from './claude-always-load-mcp-servers'

// Fresh headless Claude spawns SessionStart hooks before noting its input streams, so an
// `asyncRewake` hook that wins that race runs in the foreground and holds initialize until it
// exits. An `alwaysLoad` MCP wait makes it win every time; other start-up work only sometimes.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function declaresRewakeSessionStartHook(settings: unknown): boolean {
  const groups = isRecord(settings) && isRecord(settings.hooks) ? settings.hooks.SessionStart : []
  return (
    Array.isArray(groups) &&
    groups.some(
      (group) =>
        isRecord(group) &&
        Array.isArray(group.hooks) &&
        group.hooks.some((hook) => isRecord(hook) && hook.asyncRewake === true)
    )
  )
}

async function readsRewakeSessionStartHook(
  sources: SettingSource[],
  env: Record<string, string>,
  cwd: string
): Promise<boolean> {
  const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
  const files = [
    ...(sources.includes('user')
      ? [join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'settings.json')]
      : []),
    ...(sources.includes('project') ? [join(cwd, '.claude', 'settings.json')] : []),
    ...(sources.includes('local') ? [join(cwd, '.claude', 'settings.local.json')] : [])
  ]
  const declared = await Promise.all(
    files.map(async (file) => {
      try {
        return declaresRewakeSessionStartHook(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        return false
      }
    })
  )
  return declared.includes(true)
}

/** Resumes start hooks after reading their input, so only fresh starts that load settings race.
 *  `alwaysLoad` servers are restated without it; `rewakeHookMayHold` says the race can still
 *  be lost. */
export async function prepareClaudeFreshStart<
  TOptions extends Pick<Options, 'resume' | 'continue' | 'settingSources' | 'mcpServers'>
>(
  options: TOptions,
  env: Record<string, string>,
  cwd: string
): Promise<{ options: TOptions; rewakeHookMayHold: boolean }> {
  const sources = options.settingSources ?? []
  if (options.resume !== undefined || options.continue === true || sources.length === 0) {
    return { options, rewakeHookMayHold: false }
  }
  const [restated, rewakeHookMayHold] = await Promise.all([
    sources.includes('user') ? readClaudeAlwaysLoadMcpServers(env, cwd) : {},
    readsRewakeSessionStartHook(sources, env, cwd)
  ])
  return {
    options:
      Object.keys(restated).length > 0
        ? { ...options, mcpServers: { ...restated, ...options.mcpServers } }
        : options,
    rewakeHookMayHold
  }
}
