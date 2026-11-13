import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../filesystem/atomic-file-publication'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import type { HomeChat, HomeChatSettings } from '../../shared/home-chat/home-chat-types'
import type { HomeChatBackendState } from './backends/home-chat-backend'

const SAVE_DELAY_MS = 400

export type StoredHomeChat = { chat: HomeChat; backendState: HomeChatBackendState }

type StoredSettings = Omit<HomeChatSettings, 'openai'> & {
  openai: Omit<HomeChatSettings['openai'], 'apiKeyConfigured'>
}

const DEFAULT_SETTINGS: StoredSettings = {
  defaultBackend: 'claude-code',
  openai: { baseUrl: 'https://openrouter.ai/api/v1', model: '' }
}

const apiKeyStore = createEncryptedApiKeyFileStore({
  fileName: 'home-chat-openai-api-key.enc',
  envelopePrefix: 'seal-home-chat-api-key:v1:',
  providerLabel: 'Assistant model API',
  logScope: 'home-chat'
})

async function readJson(path: string): Promise<unknown> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    return parsed
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isStoredHomeChat(value: unknown): value is StoredHomeChat {
  return (
    isRecord(value) &&
    isRecord(value.chat) &&
    typeof value.chat.id === 'string' &&
    Array.isArray(value.chat.entries) &&
    isRecord(value.backendState)
  )
}

function parseStoredSettings(value: unknown): StoredSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS
  }
  const openai = isRecord(value.openai) ? value.openai : {}
  return {
    defaultBackend:
      value.defaultBackend === 'openai-compatible' ? 'openai-compatible' : 'claude-code',
    openai: {
      baseUrl:
        typeof openai.baseUrl === 'string' ? openai.baseUrl : DEFAULT_SETTINGS.openai.baseUrl,
      model: typeof openai.model === 'string' ? openai.model : DEFAULT_SETTINGS.openai.model
    }
  }
}

/** Chats live one file each under userData so a corrupt chat never loses the others. */
export class HomeChatStore {
  private readonly chatsDir: string
  private readonly settingsPath: string
  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly chats = new Map<string, StoredHomeChat>()
  private settings: StoredSettings = DEFAULT_SETTINGS

  private constructor(rootDir: string) {
    this.chatsDir = join(rootDir, 'chats')
    this.settingsPath = join(rootDir, 'settings.json')
  }

  static async open(rootDir: string): Promise<HomeChatStore> {
    const store = new HomeChatStore(rootDir)
    await mkdir(store.chatsDir, { recursive: true })
    for (const file of await readdir(store.chatsDir)) {
      const stored = file.endsWith('.json') ? await readJson(join(store.chatsDir, file)) : null
      if (isStoredHomeChat(stored)) {
        store.chats.set(stored.chat.id, normalizeLoadedChat(stored))
      }
    }
    store.settings = parseStoredSettings(await readJson(store.settingsPath))
    return store
  }

  list(): StoredHomeChat[] {
    return [...this.chats.values()].sort((a, b) => b.chat.updatedAt - a.chat.updatedAt)
  }

  get(chatId: string): StoredHomeChat | undefined {
    return this.chats.get(chatId)
  }

  /** Keep the in-memory copy current and write it shortly after the last change. */
  put(stored: StoredHomeChat): void {
    this.chats.set(stored.chat.id, stored)
    clearTimeout(this.pendingSaves.get(stored.chat.id))
    this.pendingSaves.set(
      stored.chat.id,
      setTimeout(() => this.flush(stored.chat.id), SAVE_DELAY_MS)
    )
  }

  delete(chatId: string): void {
    clearTimeout(this.pendingSaves.get(chatId))
    this.pendingSaves.delete(chatId)
    this.chats.delete(chatId)
    void rm(this.chatPath(chatId), { force: true }).catch(() => {})
  }

  flushAll(): void {
    for (const chatId of this.pendingSaves.keys()) {
      this.flush(chatId)
    }
  }

  readSettings(): HomeChatSettings {
    return {
      defaultBackend: this.settings.defaultBackend,
      openai: { ...this.settings.openai, apiKeyConfigured: apiKeyStore.has() }
    }
  }

  writeSettings(settings: HomeChatSettings, apiKey?: string | null): void {
    const { apiKeyConfigured: _configured, ...openai } = settings.openai
    this.settings = { defaultBackend: settings.defaultBackend, openai }
    writeFileAtomically(this.settingsPath, JSON.stringify(this.settings, null, 2))
    if (apiKey === null || apiKey === '') {
      apiKeyStore.clear()
    } else if (apiKey !== undefined) {
      apiKeyStore.save(apiKey)
    }
  }

  readApiKey(): string | null {
    return apiKeyStore.read()
  }

  private flush(chatId: string): void {
    clearTimeout(this.pendingSaves.get(chatId))
    this.pendingSaves.delete(chatId)
    const stored = this.chats.get(chatId)
    if (stored) {
      writeFileAtomically(this.chatPath(chatId), JSON.stringify(stored))
    }
  }

  private chatPath(chatId: string): string {
    // Ids are main-generated UUIDs; strip anything else so a crafted id cannot escape the folder.
    return join(this.chatsDir, `${chatId.replace(/[^a-zA-Z0-9-]/g, '')}.json`)
  }
}

/** A chat saved mid-turn reopens idle, with its unfinished pieces settled. */
function normalizeLoadedChat(stored: StoredHomeChat): StoredHomeChat {
  const entries = stored.chat.entries.map((entry) => {
    if ((entry.kind === 'assistant' || entry.kind === 'thinking') && entry.streaming) {
      return { ...entry, streaming: false }
    }
    if (
      entry.kind === 'tool' &&
      (entry.status === 'running' || entry.status === 'awaiting-approval')
    ) {
      return {
        ...entry,
        status: 'error' as const,
        output: entry.output ?? 'Interrupted when Seal closed.'
      }
    }
    return entry
  })
  return { ...stored, chat: { ...stored.chat, status: 'idle', entries } }
}
