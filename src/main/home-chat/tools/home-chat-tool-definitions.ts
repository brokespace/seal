import { z } from 'zod'
import { HOME_CHAT_ASSISTANT_TOOLS } from './home-chat-assistant-tool-specs'
import { HOME_CHAT_MACHINE_TOOLS } from './home-chat-machine-tool-specs'

/** One schema per tool, shared by the Claude MCP server and the OpenAI-compatible loop. */
export const HOME_CHAT_TOOLS = { ...HOME_CHAT_MACHINE_TOOLS, ...HOME_CHAT_ASSISTANT_TOOLS }

export type HomeChatToolName = keyof typeof HOME_CHAT_TOOLS

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
