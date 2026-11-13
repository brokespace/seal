import type { HomeChatNoticeSource } from '../../../shared/home-chat/home-chat-types'
import {
  createHomeChatAssistantRuntime,
  type HomeChatAssistantRuntime
} from '../home-chat-assistant-runtime'
import type { HomeChatSealAccess } from '../home-chat-assistant-services'
import type { HomeChatWorkerHost } from '../delegation/home-chat-subagents'
import type { HomeChatMachineProvider } from '../machines/home-chat-machine-types'
import type { HomeChatToolContext } from '../tools/home-chat-tool-executor'

export type RecordedWake = { chatId: string; source: HomeChatNoticeSource; text: string }

export const unusedWorkers: HomeChatWorkerHost = {
  create: () => {
    throw new Error('unused')
  },
  send: () => undefined,
  stop: () => undefined,
  isRunning: () => false,
  lastAnswer: () => ''
}

const unused = (): Promise<never> => Promise.reject(new Error('unused'))

export const unusedSeal: HomeChatSealAccess = {
  sessions: { list: unused, transcript: unused, send: unused },
  accounts: { usage: unused, swap: unused },
  open: () => undefined
}

/** A real runtime rooted in a temp dir, recording every wake instead of starting turns. */
export function createTestHomeChatRuntime(
  rootDir: string,
  machines: HomeChatMachineProvider,
  overrides: {
    workers?: HomeChatWorkerHost
    runOrcaCli?: HomeChatToolContext['runOrcaCli']
    seal?: HomeChatSealAccess
  } = {}
): { runtime: HomeChatAssistantRuntime; wakes: RecordedWake[] } {
  const wakes: RecordedWake[] = []
  const runtime = createHomeChatAssistantRuntime({
    rootDir,
    createMachines: () => machines,
    runOrcaCli: overrides.runOrcaCli ?? (() => Promise.reject(new Error('unused'))),
    repos: () => [],
    webConfig: () => ({ searchProvider: 'duckduckgo', searxngUrl: '', apiKey: null }),
    wake: (chatId, source, text) => wakes.push({ chatId, source, text }),
    memoryChanged: () => undefined,
    workers: overrides.workers ?? unusedWorkers,
    seal: overrides.seal ?? unusedSeal
  })
  return { runtime, wakes }
}

export function testToolContext(
  runtime: HomeChatAssistantRuntime,
  chatId = 'c1'
): HomeChatToolContext & { progress: string[]; attachments: string[] } {
  const progress: string[] = []
  const attachments: string[] = []
  return {
    chatId,
    machines: runtime.machines,
    runOrcaCli: () => Promise.reject(new Error('unused')),
    services: runtime.services,
    reportProgress: (message) => progress.push(message),
    showAttachment: (attachment) => attachments.push(attachment.name),
    progress,
    attachments
  }
}
