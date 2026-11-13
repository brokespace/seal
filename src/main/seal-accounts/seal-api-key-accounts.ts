import { randomUUID } from 'node:crypto'
import type { SealAccountKey, SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { apiKeyAccountKey } from '../../shared/seal-accounts/seal-account-key'
import { withApiKey, withoutApiKey } from '../../shared/seal-accounts/seal-accounts-config-edits'
import type { SealAccountManager } from './seal-account-manager'

/** The secret goes to the keychain vault; the config only keeps a label and the last 4 characters. */
export function addSealApiKey(
  manager: SealAccountManager,
  provider: SealProvider,
  label: string,
  apiKey: string
): SealAccountKey {
  const id = randomUUID().slice(0, 8)
  manager.vault.save(id, apiKey)
  manager.saveConfig(
    withApiKey(manager.getConfig(), {
      id,
      provider,
      label,
      keyHint: `…${apiKey.slice(-4)}`,
      createdAt: manager.now()
    })
  )
  return apiKeyAccountKey(provider, id)
}

export function removeSealApiKey(manager: SealAccountManager, id: string): void {
  manager.vault.remove(id)
  manager.saveConfig(withoutApiKey(manager.getConfig(), id))
}
