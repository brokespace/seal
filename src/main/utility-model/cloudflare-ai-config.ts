import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import {
  CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
  CLOUDFLARE_AI_DEFAULT_MODEL
} from '../../shared/utility-model/utility-model-types'
import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import { isRecord } from '../home-chat/home-chat-record-guard'
import type { CloudflareAiCredentials } from './cloudflare-workers-ai-provider'

export type CloudflareAiConfig = {
  credentials: CloudflareAiCredentials | null
  /** Where the credentials came from. */
  source: 'settings' | 'config-file' | null
  model: string
  fallbackModel: string
  tokenProtection: SecretAtRestProtection | null
}

export type CloudflareAiConfigFields = {
  accountId?: string
  apiToken?: string
  model?: string
  fallbackModel?: string
}

/** The sealed document Settings writes: one string in the app's encrypted key file. */
export type CloudflareAiSavedStore = {
  read(): string | null
  save(value: string): void
  clear(): void
  protection(): SecretAtRestProtection | null
}

const FIELDS = ['accountId', 'apiToken', 'model', 'fallbackModel'] as const

function fieldsOf(value: unknown): CloudflareAiConfigFields {
  if (!isRecord(value)) {
    return {}
  }
  const fields: CloudflareAiConfigFields = {}
  for (const key of FIELDS) {
    const entry = value[key]
    if (typeof entry === 'string' && entry.trim()) {
      fields[key] = entry.trim()
    }
  }
  return fields
}

/** `~/.config/seal/cloudflare-ai.json`: lets a headless Seal server run with no Settings UI. */
export function cloudflareAiConfigFilePath(): string {
  return join(homedir(), '.config', 'seal', 'cloudflare-ai.json')
}

/**
 * Cloudflare Workers AI settings for this host. Settings saves a sealed document; the config file
 * fills in every field that leaves out. Neither is ever logged or returned to a client.
 */
export class CloudflareAiConfigStore {
  private readonly saved: CloudflareAiSavedStore
  private readonly configFilePath: string
  private file: { mtimeMs: number; fields: CloudflareAiConfigFields } | null = null
  private warnedUnreadableFile = false

  constructor(deps: { saved?: CloudflareAiSavedStore; configFilePath?: string } = {}) {
    this.saved =
      deps.saved ??
      createEncryptedApiKeyFileStore({
        fileName: 'seal-cloudflare-ai.enc',
        envelopePrefix: 'seal-cloudflare-ai:v1:',
        providerLabel: 'Cloudflare AI',
        logScope: 'utility-model'
      })
    this.configFilePath = deps.configFilePath ?? cloudflareAiConfigFilePath()
  }

  async load(): Promise<CloudflareAiConfig> {
    const saved = this.readSaved()
    const fields = { ...(await this.readConfigFile()), ...saved }
    const credentials =
      fields.accountId && fields.apiToken
        ? { accountId: fields.accountId, apiToken: fields.apiToken }
        : null
    const fromSettings = credentials !== null && saved.apiToken !== undefined
    return {
      credentials,
      source: fromSettings ? 'settings' : credentials ? 'config-file' : null,
      model: fields.model ?? CLOUDFLARE_AI_DEFAULT_MODEL,
      fallbackModel: fields.fallbackModel ?? CLOUDFLARE_AI_DEFAULT_FALLBACK_MODEL,
      tokenProtection: fromSettings ? this.saved.protection() : null
    }
  }

  /** Omitted fields keep their saved value. */
  save(update: CloudflareAiConfigFields): void {
    this.saved.save(JSON.stringify({ ...this.readSaved(), ...fieldsOf(update) }))
  }

  /** Forgets what Settings saved; a config file keeps working. */
  clear(): void {
    this.saved.clear()
  }

  private readSaved(): CloudflareAiConfigFields {
    try {
      const raw = this.saved.read()
      return raw ? fieldsOf(JSON.parse(raw)) : {}
    } catch {
      // Sealed by another install or unreadable: behave as if nothing was saved.
      return {}
    }
  }

  private async readConfigFile(): Promise<CloudflareAiConfigFields> {
    let mtimeMs: number
    try {
      mtimeMs = (await stat(this.configFilePath)).mtimeMs
    } catch {
      this.file = null
      return {}
    }
    if (this.file?.mtimeMs === mtimeMs) {
      return this.file.fields
    }
    try {
      this.file = {
        mtimeMs,
        fields: fieldsOf(JSON.parse(await readFile(this.configFilePath, 'utf8')))
      }
      this.warnedUnreadableFile = false
    } catch {
      this.file = { mtimeMs, fields: {} }
      if (!this.warnedUnreadableFile) {
        this.warnedUnreadableFile = true
        // A JSON parse error quotes the text it choked on, so the error itself is never logged.
        console.warn(
          '[utility-model] the Cloudflare AI config file is not readable JSON; ignoring it'
        )
      }
    }
    return this.file.fields
  }
}
