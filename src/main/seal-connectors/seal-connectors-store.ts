import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod'
import { getSecretStore, hasSecretStore } from '../../shared/secret-store'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  EMPTY_REFRESHER_LEASE,
  RefresherLeaseSchema,
  SealConnectorsConfigSchema,
  SignInSecretSchema,
  emptySealConnectorsConfig,
  type RefresherLease,
  type SealConnectorsConfig,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'

export class SealConnectorsSecretsUnavailableError extends Error {
  constructor() {
    super(
      'This machine has no OS keychain encryption available, so Seal will not store connector sign-ins here.'
    )
  }
}

export type SealConnectorsRefresherState = {
  lease: RefresherLease
  /** OAuth sign-ins whose server refused the refresh token, by sign-in id. */
  needsReconnect: string[]
}

const RefresherStateSchema = z.object({
  lease: RefresherLeaseSchema.catch(EMPTY_REFRESHER_LEASE),
  needsReconnect: z.array(z.string()).catch([])
})

const SealedSignInsSchema = z.record(z.string(), z.string())

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      console.warn(`[seal-connectors] Ignoring unreadable ${path}`)
    }
    return undefined
  }
}

function encryptionAvailable(): boolean {
  return hasSecretStore() && getSecretStore().isEncryptionAvailable()
}

/**
 * This host's copy of the central list (`config.json`), its sealed sign-ins (`sign-ins.json`) and
 * who refreshes them (`refresher.json`). Read once; memory stays authoritative after that.
 */
export class SealConnectorsStore {
  private config: SealConnectorsConfig
  private refresher: SealConnectorsRefresherState
  private sealed: Record<string, string>
  private readonly secrets = new Map<string, SignInSecret>()
  /** Sealed blobs not decrypted yet: the keychain may not be ready when the store is built. */
  private readonly undecoded: Set<string>

  constructor(private readonly dir: string) {
    const config = SealConnectorsConfigSchema.safeParse(readJson(this.path('config.json')))
    this.config = config.success ? config.data : emptySealConnectorsConfig()
    const refresher = RefresherStateSchema.safeParse(readJson(this.path('refresher.json')) ?? {})
    this.refresher = refresher.success
      ? refresher.data
      : { lease: EMPTY_REFRESHER_LEASE, needsReconnect: [] }
    const sealed = SealedSignInsSchema.safeParse(readJson(this.path('sign-ins.json')) ?? {})
    this.sealed = sealed.success ? sealed.data : {}
    this.undecoded = new Set(Object.keys(this.sealed))
  }

  private path(name: string): string {
    return join(this.dir, name)
  }

  getConfig(): SealConnectorsConfig {
    return this.config
  }

  saveConfig(config: SealConnectorsConfig): void {
    writeSecureJsonFile(this.path('config.json'), config)
    this.config = config
  }

  getRefresher(): SealConnectorsRefresherState {
    return this.refresher
  }

  saveRefresher(state: SealConnectorsRefresherState): void {
    writeSecureJsonFile(this.path('refresher.json'), state)
    this.refresher = state
  }

  isEncryptionAvailable(): boolean {
    return encryptionAvailable()
  }

  private decodePending(): void {
    if (this.undecoded.size === 0 || !encryptionAvailable()) {
      return
    }
    for (const id of this.undecoded) {
      this.undecoded.delete(id)
      try {
        const plain = getSecretStore().decryptString(Buffer.from(this.sealed[id] ?? '', 'base64'))
        const parsed = SignInSecretSchema.safeParse(JSON.parse(plain))
        if (parsed.success && parsed.data.id === id) {
          this.secrets.set(id, parsed.data)
        }
      } catch {
        console.warn('[seal-connectors] Could not decrypt a stored sign-in.')
      }
    }
  }

  canHoldSignIns(): boolean {
    return encryptionAvailable()
  }

  signIn(id: string): SignInSecret | null {
    this.decodePending()
    return this.secrets.get(id) ?? null
  }

  /** Every stored sign-in id, including ones this host cannot decrypt right now. */
  sealedIds(): string[] {
    return Object.keys(this.sealed)
  }

  saveSignIn(secret: SignInSecret): void {
    if (!encryptionAvailable()) {
      throw new SealConnectorsSecretsUnavailableError()
    }
    this.decodePending()
    const sealed = {
      ...this.sealed,
      [secret.id]: getSecretStore().encryptString(JSON.stringify(secret)).toString('base64')
    }
    writeSecureJsonFile(this.path('sign-ins.json'), sealed)
    this.sealed = sealed
    this.secrets.set(secret.id, secret)
    this.undecoded.delete(secret.id)
  }

  removeSignIn(id: string): void {
    if (!(id in this.sealed)) {
      return
    }
    const sealed = Object.fromEntries(Object.entries(this.sealed).filter(([key]) => key !== id))
    writeSecureJsonFile(this.path('sign-ins.json'), sealed)
    this.sealed = sealed
    this.secrets.delete(id)
    this.undecoded.delete(id)
  }
}
