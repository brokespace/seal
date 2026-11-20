import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HomeChatEntry, HomeChatSettings } from '../../shared/home-chat/home-chat-types'
import { createApiDriver } from './drivers/api/home-chat-api-driver'
import { estimateItemsTokens } from './engine/home-chat-compaction'
import { HomeChatService } from './home-chat-service'
import { createLocalMachine } from './machines/home-chat-local-machine'
import { resolveHomeChatMachineId } from './machines/home-chat-machine-provider'
import type { HomeChatMachineInfo } from './machines/home-chat-machine-types'
import {
  startFakeChatCompletionsServer,
  type FakeChatCompletionsServer,
  type FakeChatReply,
  type FakeChatRequest
} from './testing/fake-chat-completions-server.test-support'
import { unusedSeal } from './testing/home-chat-runtime.test-support'
import { activeItems } from './thread/home-chat-thread-history'
import { HomeChatThreadStore } from './thread/home-chat-thread-store'

const SETTINGS: HomeChatSettings = {
  defaultBackend: 'openai-compatible',
  openai: { baseUrl: '', model: 'fake', apiKeyConfigured: false, contextWindow: 128_000 },
  web: { searchProvider: 'duckduckgo', searxngUrl: '', searchApiKeyConfigured: false }
}

let root: string
let originalHome: string | undefined
let model: FakeChatCompletionsServer
let services: HomeChatService[]

/** This computer's shell, listed as a machine named kessel-ml. */
function machines() {
  const local = createLocalMachine()
  const kessel: HomeChatMachineInfo = {
    id: 'machine:kessel',
    label: 'kessel-ml',
    kind: 'remote',
    address: 'brian@kessel-ml.lan:22',
    connected: false,
    status: 'offline'
  }
  const infos = [local.info, kessel]
  return {
    list: () => Promise.resolve(infos),
    open: (name: string) =>
      Promise.resolve(
        resolveHomeChatMachineId(name, infos) === kessel.id ? { ...local, info: kessel } : local
      )
  }
}

async function openService(contextWindow?: number): Promise<HomeChatService> {
  const service = new HomeChatService({
    rootDir: root,
    threads: await HomeChatThreadStore.open(root),
    settings: {
      read: () => SETTINGS,
      write: () => undefined,
      readApiKey: () => null,
      readSearchApiKey: () => null
    },
    accounts: {
      list: () => Promise.resolve([]),
      claudeConfigDir: () => Promise.resolve(null),
      codexHome: () => Promise.resolve(null)
    },
    createMachines: machines,
    runOrcaCli: () => Promise.reject(new Error('unused')),
    repos: () => [],
    seal: unusedSeal,
    emit: () => undefined,
    driverFor: () => {
      const driver = createApiDriver({
        baseUrl: model.baseUrl,
        model: 'fake',
        apiKey: null,
        contextWindow: contextWindow ?? 128_000
      })
      return Promise.resolve(
        contextWindow === undefined
          ? driver
          : {
              ...driver,
              // Count the conversation only, so the test's sizes do not depend on the prompt's length.
              contextTokens: (thread) => estimateItemsTokens(activeItems(thread.items))
            }
      )
    }
  })
  await service.start()
  services.push(service)
  return service
}

async function ask(service: HomeChatService, chatId: string, text: string): Promise<void> {
  service.send(chatId, text)
  await expect.poll(() => service.getChat(chatId)?.status, { timeout: 15_000 }).toBe('idle')
}

/** An entry as the user sees it, without the revision counter that only orders live updates. */
function shown(entries: readonly HomeChatEntry[] | undefined): unknown[] {
  return (entries ?? []).map(({ rev: _rev, ...entry }) => entry)
}

const lastUserText = (request: FakeChatRequest): string =>
  request.messages.findLast((message) => message.role === 'user')?.content ?? ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'home-chat-service-'))
  // Jobs live under ~/.seal/jobs on the target machine.
  originalHome = process.env.HOME
  process.env.HOME = root
  services = []
})

afterEach(async () => {
  await Promise.all(services.map((service) => service.dispose()))
  await model.close()
  process.env.HOME = originalHome
  await rm(root, { recursive: true, force: true })
})

describe.skipIf(process.platform === 'win32')('HomeChatService', () => {
  it('runs a command on the machine the user names and replays the thread after a restart', async () => {
    model = await startFakeChatCompletionsServer((request): FakeChatReply => {
      const last = request.messages.at(-1)
      if (last?.role === 'tool') {
        return { text: `kessel-ml answered: ${last.content?.includes('gpu-ok') ? 'gpu-ok' : '?'}` }
      }
      return lastUserText(request).includes('kessel-ml')
        ? {
            toolCalls: [
              {
                id: 'call_1',
                name: 'run_command',
                args: { machine: 'KESSEL-ML', command: 'echo gpu-ok' }
              }
            ]
          }
        : { text: 'It was gpu-ok.' }
    })
    const first = await openService()
    const chatId = first.createChat().id
    await ask(first, chatId, 'reach out to kessel-ml and check the gpu')

    const live = first.getChat(chatId)
    expect(live?.lastMachine).toBe('kessel-ml')
    expect(
      live?.entries.map((entry) => [
        entry.kind,
        entry.kind === 'tool'
          ? `${entry.tool}@${entry.machine}:${entry.status}`
          : 'text' in entry && entry.text
      ])
    ).toEqual([
      ['user', 'reach out to kessel-ml and check the gpu'],
      ['tool', 'run_command@kessel-ml:ok'],
      ['assistant', 'kessel-ml answered: gpu-ok']
    ])

    await first.dispose()
    const second = await openService()
    expect(shown(second.getChat(chatId)?.entries)).toEqual(shown(live?.entries))

    await ask(second, chatId, 'what did it say?')
    const replayed = model.requests.at(-1)?.messages ?? []
    expect(replayed.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user'
    ])
    expect(replayed[2].tool_calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: {
          name: 'run_command',
          arguments: '{"machine":"KESSEL-ML","command":"echo gpu-ok"}'
        }
      }
    ])
    expect(replayed[3].tool_call_id).toBe('call_1')
    expect(replayed[3].content).toContain('gpu-ok')
    expect(replayed[5].content).toBe('what did it say?')
    expect(second.getChat(chatId)?.entries.at(-1)).toMatchObject({
      kind: 'assistant',
      text: 'It was gpu-ok.'
    })
  })

  it('summarizes a long thread for the model while the user keeps every message', async () => {
    const pad = (label: string): string => `${label} ${'x'.repeat(300 - label.length - 1)}`
    model = await startFakeChatCompletionsServer((request) => {
      const text = lastUserText(request)
      return text.includes('Do not call tools')
        ? { text: 'SUMMARY-OF-EARLIER-TURNS' }
        : { text: pad(`answer-to-${text.slice(0, 6)}`) }
    })
    const service = await openService(1_000)
    const chatId = service.createChat().id
    for (const label of ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5']) {
      await ask(service, chatId, pad(label))
    }

    const chat = service.getChat(chatId)
    expect(chat?.context.compactions).toBe(1)
    expect(chat?.entries.map((entry) => entry.kind)).toEqual([
      ...Array.from({ length: 4 }, () => ['user', 'assistant']).flat(),
      'compaction',
      'user',
      'assistant'
    ])
    expect(chat?.entries.at(-3)).toMatchObject({ summary: 'SUMMARY-OF-EARLIER-TURNS' })
    expect(JSON.stringify(chat?.entries)).not.toMatch(/Automatic note from Seal|Do not call tools/)

    await service.dispose()
    const reopened = await openService(1_000)
    await ask(reopened, chatId, 'turn-6')
    const sent = model.requests.at(-1)?.messages ?? []
    expect(sent.map((message) => message.role)).toEqual([
      'system',
      'user',
      'user',
      'assistant',
      'user'
    ])
    expect(sent[1].content).toMatch(/^\[Automatic note from Seal/)
    expect(sent[1].content).toContain('SUMMARY-OF-EARLIER-TURNS')
    expect(sent[2].content).toBe(pad('turn-5'))
    expect(sent[3].content).toBe(pad('answer-to-turn-5'))
    expect(sent[4].content).toBe('turn-6')
    expect(JSON.stringify(sent)).not.toContain('turn-1')
  })
})
