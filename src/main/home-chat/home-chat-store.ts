import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

/** Chats live one file each under userData so a corrupt chat never loses the others. */
export class HomeChatStore {
  private readonly chatsDir: string
  private readonly settingsPath: string
  private readonly pendingSaves = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly chats = new Map<string, StoredHomeChat>()

  constructor(rootDir: string) {
    this.chatsDir = join(rootDir, 'chats')
    this.settingsPath = join(rootDir, 'settings.json')
    mkdirSync(this.chatsDir, { recursive: true })
    for (const file of readdirSync(this.chatsDir)) {
      const stored = file.endsWith('.json')
        ? readJson<StoredHomeChat>(join(this.chatsDir, file))
        : null
      if (stored?.chat?.id && Array.isArray(stored.chat.entries)) {
        this.chats.set(stored.chat.id, normalizeLoadedChat(stored))
      }
    }
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
    rmSync(this.chatPath(chatId), { force: true })
  }

  flushAll(): void {
    for (const chatId of this.pendingSaves.keys()) {
      this.flush(chatId)
    }
  }

  readSettings(): HomeChatSettings {
    const stored = readJson<Partial<StoredSettings>>(this.settingsPath)
    return {
      defaultBackend: stored?.defaultBackend ?? DEFAULT_SETTINGS.defaultBackend,
      openai: {
        ...DEFAULT_SETTINGS.openai,
        ...stored?.openai,
        apiKeyConfigured: apiKeyStore.has()
      }
    }
  }

  writeSettings(settings: HomeChatSettings, apiKey?: string | null): void {
    const { apiKeyConfigured: _configured, ...openai } = settings.openai
    writeFileAtomically(this.settingsPath, JSON.stringify({ ...settings, openai }, null, 2))
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
