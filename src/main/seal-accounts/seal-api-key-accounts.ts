import { randomUUID } from 'node:crypto'
import type { SealAccountKey, SealProvider } from '../../shared/seal-accounts/seal-accounts-config'
import { apiKeyAccountKey } from '../../shared/seal-accounts/seal-account-key'
import { withApiKey, withoutApiKey } from '../../shared/seal-accounts/seal-accounts-config-edits'
import type { SealAccountManager } from './seal-account-manager'

const SETUP_TOKEN_PREFIX = 'sk-ant-oat'
const ANTHROPIC_API_KEY_PREFIX = 'sk-ant-api'

/** Catches a secret pasted into the wrong form before it is stored and fails at launch. */
function assertSecretKind(
  provider: SealProvider,
  credential: 'api-key' | 'setup-token',
  secret: string
): void {
  if (credential === 'setup-token') {
    if (provider !== 'claude') {
      throw new Error(
        'Setup tokens are a Claude feature. Add a Codex account or an OpenAI API key.'
      )
    }
    if (!secret.startsWith(SETUP_TOKEN_PREFIX)) {
      throw new Error(
        'That is not a Claude setup token. Run `claude setup-token` and paste the token it prints (it starts with sk-ant-oat).'
      )
    }
    return
  }
  if (secret.startsWith(SETUP_TOKEN_PREFIX)) {
    throw new Error('That is a Claude setup token, not an API key. Add it as a Claude account.')
  }
  if (provider === 'codex' && secret.startsWith(ANTHROPIC_API_KEY_PREFIX)) {
    throw new Error('That is an Anthropic API key. Add it as an Anthropic key instead.')
  }
}

/** The secret goes to the keychain vault; the config only keeps a label and the last 4 characters. */
export function addSealApiKey(
  manager: SealAccountManager,
  provider: SealProvider,
  label: string,
  apiKey: string,
  credential: 'api-key' | 'setup-token' = 'api-key'
): SealAccountKey {
  assertSecretKind(provider, credential, apiKey)
  const id = randomUUID().slice(0, 8)
  manager.vault.save(id, apiKey)
  manager.saveConfig(
    withApiKey(manager.getConfig(), {
      id,
      provider,
      label,
      keyHint: `…${apiKey.slice(-4)}`,
      createdAt: manager.now(),
      ...(credential === 'setup-token' ? { credential } : {})
    })
  )
  return apiKeyAccountKey(provider, id)
}

export function removeSealApiKey(manager: SealAccountManager, id: string): void {
  manager.vault.remove(id)
  manager.saveConfig(withoutApiKey(manager.getConfig(), id))
}
