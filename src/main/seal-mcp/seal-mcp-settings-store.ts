import { readFile } from 'node:fs/promises'
import type { SealMcpSettings } from '../../shared/seal-mcp/seal-mcp-types'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'

/** Both network doors start shut: a person opens them, then mints a client token. */
const DEFAULT_SETTINGS: SealMcpSettings = { httpEnabled: false, relayEnabled: false }

export class SealMcpSettingsStore {
  private settings: SealMcpSettings = { ...DEFAULT_SETTINGS }

  constructor(private readonly path: string) {}

  /** Reads the saved switches. Until it resolves both read as off. */
  async load(): Promise<void> {
    try {
      const stored: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      if (typeof stored === 'object' && stored !== null) {
        this.settings = {
          httpEnabled: 'httpEnabled' in stored && stored.httpEnabled === true,
          relayEnabled: 'relayEnabled' in stored && stored.relayEnabled === true
        }
      }
    } catch {
      // Missing or unreadable: both stay off.
    }
  }

  get(): SealMcpSettings {
    return { ...this.settings }
  }

  update(patch: Partial<SealMcpSettings>): SealMcpSettings {
    this.settings = {
      httpEnabled: patch.httpEnabled ?? this.settings.httpEnabled,
      relayEnabled: patch.relayEnabled ?? this.settings.relayEnabled
    }
    writeSecureJsonFile(this.path, this.settings)
    return this.get()
  }
}
