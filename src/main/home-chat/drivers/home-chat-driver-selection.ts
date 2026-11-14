import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { HomeChatAccountProvider } from '../home-chat-accounts'
import type { HomeChatSettingsStore } from '../home-chat-settings-store'
import type { HomeChatThread } from '../thread/home-chat-thread'
import { createApiDriver } from './api/home-chat-api-driver'
import { createClaudeDriver } from './claude/home-chat-claude-driver'
import { createCodexDriver } from './codex/home-chat-codex-driver'
import type { HomeChatDriver } from './home-chat-driver'

export type HomeChatDriverSources = {
  rootDir: string
  settings: Pick<HomeChatSettingsStore, 'read' | 'readApiKey'>
  accounts: HomeChatAccountProvider
}

/** A driver exists for one call; none of them keeps a process between turns. */
export async function homeChatDriverFor(
  thread: HomeChatThread,
  sources: HomeChatDriverSources
): Promise<HomeChatDriver> {
  const { backend, accountId, model } = thread.meta
  if (backend === 'openai-compatible') {
    const { openai } = sources.settings.read()
    return createApiDriver({
      baseUrl: openai.baseUrl,
      model: model || openai.model,
      apiKey: sources.settings.readApiKey(),
      contextWindow: openai.contextWindow
    })
  }
  // A fixed, empty folder: the CLIs file sessions by working folder and must not see a project.
  const cwd = join(sources.rootDir, 'workspace')
  await mkdir(cwd, { recursive: true })
  return backend === 'codex'
    ? createCodexDriver({ cwd, codexHome: await sources.accounts.codexHome(accountId), model })
    : createClaudeDriver({
        cwd,
        claudeConfigDir: await sources.accounts.claudeConfigDir(accountId),
        model
      })
}

/** The line the thread shows after its model source, account or model changed. */
export async function modelChangeNote(
  thread: HomeChatThread,
  sources: Pick<HomeChatDriverSources, 'settings' | 'accounts'>
): Promise<string> {
  const { backend, accountId, model } = thread.meta
  if (backend === 'openai-compatible') {
    const name = model || sources.settings.read().openai.model || 'the default model'
    return `Now answering with ${name} through the model API.`
  }
  const accounts = await sources.accounts.list().catch(() => [])
  const account = accounts.find((option) => option.backend === backend && option.id === accountId)
  return `Now answering with ${backend === 'codex' ? 'Codex' : 'Claude'} on ${accountId === null ? 'the system login' : (account?.label ?? 'a removed account')}.`
}
