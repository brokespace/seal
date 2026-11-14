import { readFileSync } from 'node:fs'
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

function loadSealed(path: string): SealedKeys {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
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

/** API keys sealed with the OS keychain (Electron safeStorage, or orcad's secret store). */
export class SealApiKeyVault {
  constructor(private readonly dir: string) {}

  private get path(): string {
    return join(this.dir, 'api-keys.json')
  }

  private sealed: SealedKeys | null = null

  /** Loaded once; the vault is the file's only writer, so memory stays authoritative. */
  private readSealed(): SealedKeys {
    this.sealed ??= loadSealed(this.path)
    return this.sealed
  }

  isAvailable(): boolean {
    return hasSecretStore() && getSecretStore().isEncryptionAvailable()
  }

  /** Why keys cannot be stored here, or how weakly they are sealed; null when the OS keychain seals them. */
  protectionGap(): string | null {
    if (this.isAvailable()) {
      return getSecretStore().describeProtectionGap()
    }
    // The store's own notice says secrets go unencrypted; this vault refuses to store them instead.
    const remedy =
      process.platform === 'linux'
        ? 'Install and unlock gnome-keyring or kwallet, or start Seal with --password-store=gnome-libsecret (--password-store=kwallet6 on KDE).'
        : 'Unlock the login keychain, then restart Seal.'
    return `Seal cannot reach an OS keychain on this computer, so API keys and setup tokens cannot be added here. Browser and device-code sign-ins still work. ${remedy}`
  }

  storedIds(): Set<string> {
    return new Set(Object.keys(this.readSealed()))
  }

  save(id: string, apiKey: string): void {
    if (!this.isAvailable()) {
      throw new SealApiKeyVaultUnavailableError()
    }
    const sealed = {
      ...this.readSealed(),
      [id]: getSecretStore().encryptString(apiKey).toString('base64')
    }
    writeSecureJsonFile(this.path, sealed)
    this.sealed = sealed
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
    const next = Object.fromEntries(Object.entries(sealed).filter(([saved]) => saved !== id))
    writeSecureJsonFile(this.path, next)
    this.sealed = next
  }
}
