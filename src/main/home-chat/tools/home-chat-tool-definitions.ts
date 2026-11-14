import { z } from 'zod'
import { HOME_CHAT_ASSISTANT_TOOLS } from './home-chat-assistant-tool-specs'
import { HOME_CHAT_MACHINE_TOOLS } from './home-chat-machine-tool-specs'
import { HOME_CHAT_SEAL_TOOLS } from './home-chat-seal-tool-specs'

/** One schema per tool, shared by every driver: the Claude and Codex MCP servers and the API loop. */
export const HOME_CHAT_TOOLS = {
  ...HOME_CHAT_MACHINE_TOOLS,
  ...HOME_CHAT_ASSISTANT_TOOLS,
  ...HOME_CHAT_SEAL_TOOLS
}

export type HomeChatToolName = keyof typeof HOME_CHAT_TOOLS
export type HomeChatMachineToolName = keyof typeof HOME_CHAT_MACHINE_TOOLS
export type HomeChatAssistantToolName = keyof typeof HOME_CHAT_ASSISTANT_TOOLS
export type HomeChatSealToolName = keyof typeof HOME_CHAT_SEAL_TOOLS

export function isHomeChatMachineToolName(name: string): name is HomeChatMachineToolName {
  return Object.hasOwn(HOME_CHAT_MACHINE_TOOLS, name)
}

export function isHomeChatSealToolName(name: string): name is HomeChatSealToolName {
  return Object.hasOwn(HOME_CHAT_SEAL_TOOLS, name)
}

/** Lookups that change nothing and do not depend on each other, so a round may run them together. */
export const PARALLEL_SAFE_TOOLS: ReadonlySet<string> = new Set<HomeChatToolName>([
  'list_machines',
  'read_file',
  'job_status',
  'job_output',
  'list_sessions',
  'read_session',
  'account_usage',
  'list_skills',
  'load_skill',
  'web_search',
  'web_fetch',
  'check_subagent'
])

export function isHomeChatToolName(name: string): name is HomeChatToolName {
  return Object.hasOwn(HOME_CHAT_TOOLS, name)
}

/** Validate untrusted tool arguments against the tool's schema. */
export function parseHomeChatToolInput(
  name: HomeChatToolName,
  input: unknown
): Record<string, unknown> {
  return z.object(HOME_CHAT_TOOLS[name].shape).parse(input ?? {})
}

export function homeChatToolJsonSchema(name: HomeChatToolName): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(z.object(HOME_CHAT_TOOLS[name].shape))
  return schema
}
