import type { HomeChatAssistantServices } from '../home-chat-assistant-services'
import type { HomeChatAttachmentInfo } from '../attachments/home-chat-attachments'
import type {
  HomeChatExecResult,
  HomeChatMachineProvider
} from '../machines/home-chat-machine-types'

const MAX_TOOL_OUTPUT_CHARS = 30_000

export type HomeChatToolContext = {
  chatId: string
  machines: HomeChatMachineProvider
  runOrcaCli: (
    args: readonly string[],
    options: { timeoutMs: number; signal?: AbortSignal }
  ) => Promise<HomeChatExecResult>
  services: HomeChatAssistantServices
  reportProgress: (message: string) => void
  showAttachment: (attachment: HomeChatAttachmentInfo & { machine?: string }) => void
  signal?: AbortSignal
}

export type HomeChatToolResult = { text: string; isError: boolean; machine?: string }

export function clipToolText(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) {
    return text
  }
  const half = MAX_TOOL_OUTPUT_CHARS / 2
  return `${text.slice(0, half)}\n… [${text.length - MAX_TOOL_OUTPUT_CHARS} characters omitted] …\n${text.slice(-half)}`
}

export function formatExecResult(result: HomeChatExecResult): HomeChatToolResult {
  const status = result.timedOut ? 'timed out' : `exit code ${result.exitCode ?? 'unknown'}`
  const parts = [status]
  if (result.stdout.trim()) {
    parts.push(`stdout:\n${clipToolText(result.stdout.trimEnd())}`)
  }
  if (result.stderr.trim()) {
    parts.push(`stderr:\n${clipToolText(result.stderr.trimEnd())}`)
  }
  return { text: parts.join('\n\n'), isError: result.timedOut || result.exitCode !== 0 }
}

export const str = (value: unknown): string => String(value ?? '')
export const optionalStr = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value : undefined
