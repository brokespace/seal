import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../filesystem/atomic-file-publication'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import {
  HOME_CHAT_BACKEND_KINDS,
  type HomeChatSearchProvider,
  type HomeChatSettings,
  type HomeChatSettingsUpdate
} from '../../shared/home-chat/home-chat-types'
import { isRecord } from './home-chat-record-guard'

type StoredSettings = Omit<HomeChatSettings, 'openai' | 'web'> & {
  openai: Omit<HomeChatSettings['openai'], 'apiKeyConfigured'>
  web: Omit<HomeChatSettings['web'], 'searchApiKeyConfigured'>
}

export const DEFAULT_API_CONTEXT_WINDOW = 128_000
const MIN_CONTEXT_WINDOW = 1_000

const DEFAULT_SETTINGS: StoredSettings = {
  defaultBackend: 'claude-code',
  openai: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    contextWindow: DEFAULT_API_CONTEXT_WINDOW
  },
  web: { searchProvider: 'duckduckgo', searxngUrl: '' }
}

const SEARCH_PROVIDERS: readonly HomeChatSearchProvider[] = [
  'duckduckgo',
  'brave',
  'tavily',
  'searxng'
]

const apiKeyStore = createEncryptedApiKeyFileStore({
  fileName: 'home-chat-openai-api-key.enc',
  envelopePrefix: 'seal-home-chat-api-key:v1:',
  providerLabel: 'Assistant model API',
  logScope: 'home-chat'
})

const searchKeyStore = createEncryptedApiKeyFileStore({
  fileName: 'home-chat-search-api-key.enc',
  envelopePrefix: 'seal-home-chat-search-key:v1:',
  providerLabel: 'Assistant web search',
  logScope: 'home-chat'
})

function saveKey(store: typeof apiKeyStore, key: string | null | undefined): void {
  if (key === null || key === '') {
    store.clear()
  } else if (key !== undefined) {
    store.save(key)
  }
}

export function normalizeContextWindow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_CONTEXT_WINDOW
    ? Math.round(value)
    : DEFAULT_API_CONTEXT_WINDOW
}

function parseStoredSettings(value: unknown): StoredSettings {
  if (!isRecord(value)) {
    return DEFAULT_SETTINGS
  }
  const openai = isRecord(value.openai) ? value.openai : {}
  const web = isRecord(value.web) ? value.web : {}
  return {
    web: {
      searchProvider:
        SEARCH_PROVIDERS.find((provider) => provider === web.searchProvider) ??
        DEFAULT_SETTINGS.web.searchProvider,
      searxngUrl: typeof web.searxngUrl === 'string' ? web.searxngUrl : ''
    },
    defaultBackend:
      HOME_CHAT_BACKEND_KINDS.find((kind) => kind === value.defaultBackend) ?? 'claude-code',
    openai: {
      baseUrl:
        typeof openai.baseUrl === 'string' ? openai.baseUrl : DEFAULT_SETTINGS.openai.baseUrl,
      model: typeof openai.model === 'string' ? openai.model : DEFAULT_SETTINGS.openai.model,
      contextWindow: normalizeContextWindow(openai.contextWindow)
    }
  }
}

/** The assistant's settings; API keys stay in the OS-encrypted key files, never in settings.json. */
export class HomeChatSettingsStore {
  private settings: StoredSettings = DEFAULT_SETTINGS

  private constructor(private readonly settingsPath: string) {}

  static async open(rootDir: string): Promise<HomeChatSettingsStore> {
    await mkdir(rootDir, { recursive: true })
    const store = new HomeChatSettingsStore(join(rootDir, 'settings.json'))
    store.settings = parseStoredSettings(
      await readFile(store.settingsPath, 'utf8')
        .then((text): unknown => JSON.parse(text))
        .catch(() => null)
    )
    return store
  }

  read(): HomeChatSettings {
    return {
      defaultBackend: this.settings.defaultBackend,
      openai: { ...this.settings.openai, apiKeyConfigured: apiKeyStore.has() },
      web: { ...this.settings.web, searchApiKeyConfigured: searchKeyStore.has() }
    }
  }

  write(
    settings: HomeChatSettings,
    keys: { apiKey?: string | null; searchApiKey?: string | null } = {}
  ): void {
    const { apiKeyConfigured: _configured, ...openai } = settings.openai
    const { searchApiKeyConfigured: _searchConfigured, ...web } = settings.web
    this.settings = { defaultBackend: settings.defaultBackend, openai, web }
    writeFileAtomically(this.settingsPath, JSON.stringify(this.settings, null, 2))
    saveKey(apiKeyStore, keys.apiKey)
    saveKey(searchKeyStore, keys.searchApiKey)
  }

  readApiKey(): string | null {
    return apiKeyStore.read()
  }

  readSearchApiKey(): string | null {
    return searchKeyStore.read()
  }
}

/** The settings after a partial update; secrets travel separately. */
export function mergeHomeChatSettings(
  current: HomeChatSettings,
  update: HomeChatSettingsUpdate
): HomeChatSettings {
  return {
    defaultBackend: update.defaultBackend ?? current.defaultBackend,
    openai: {
      ...current.openai,
      ...(update.openai?.baseUrl !== undefined ? { baseUrl: update.openai.baseUrl.trim() } : {}),
      ...(update.openai?.model !== undefined ? { model: update.openai.model.trim() } : {}),
      ...(update.openai?.contextWindow !== undefined
        ? { contextWindow: normalizeContextWindow(update.openai.contextWindow) }
        : {})
    },
    web: {
      ...current.web,
      ...(update.web?.searchProvider ? { searchProvider: update.web.searchProvider } : {}),
      ...(update.web?.searxngUrl !== undefined ? { searxngUrl: update.web.searxngUrl.trim() } : {})
    }
  }
}
