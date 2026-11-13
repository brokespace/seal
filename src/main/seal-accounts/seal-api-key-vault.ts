import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getSecretStore, hasSecretStore } from '../../shared/secret-store'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'

type SealedKeys = Record<string, string>

export class SealApiKeyVaultUnavailableError extends Error {
  constructor() {
    super(
      'This machine has no OS keychain encryption available, so Seal will not store API keys here.'
    )
  }
}

/** API keys sealed with the OS keychain (Electron safeStorage, or orcad's secret store). */
export class SealApiKeyVault {
  constructor(private readonly dir: string) {}

  private get path(): string {
    return join(this.dir, 'api-keys.json')
  }

  private readSealed(): SealedKeys {
    if (!existsSync(this.path)) {
      return {}
    }
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {}
      }
      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    } catch {
      return {}
    }
  }

  isAvailable(): boolean {
    return hasSecretStore() && getSecretStore().isEncryptionAvailable()
  }

  protectionGap(): string | null {
    if (!hasSecretStore()) {
      return 'No secret store is configured on this host.'
    }
    return getSecretStore().describeProtectionGap()
  }

  storedIds(): Set<string> {
    return new Set(Object.keys(this.readSealed()))
  }

  save(id: string, apiKey: string): void {
    if (!this.isAvailable()) {
      throw new SealApiKeyVaultUnavailableError()
    }
    const sealed = this.readSealed()
    sealed[id] = getSecretStore().encryptString(apiKey).toString('base64')
    writeSecureJsonFile(this.path, sealed)
  }

  read(id: string): string | null {
    const blob = this.readSealed()[id]
    if (!blob || !this.isAvailable()) {
      return null
    }
    try {
      return getSecretStore().decryptString(Buffer.from(blob, 'base64'))
    } catch (error) {
      console.warn('[seal-accounts] Could not decrypt a stored API key:', error)
      return null
    }
  }

  remove(id: string): void {
    const sealed = this.readSealed()
    if (!(id in sealed)) {
      return
    }
    delete sealed[id]
    writeSecureJsonFile(this.path, sealed)
  }
}
