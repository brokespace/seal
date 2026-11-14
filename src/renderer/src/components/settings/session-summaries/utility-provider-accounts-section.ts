import type { UtilityModelProviderId } from '../../../../../shared/utility-model/utility-model-types'
import { ACCOUNTS_SECTION_IDS } from '../accounts/accounts-search'
import { CLOUDFLARE_AI_SECTION_ID } from '../accounts/cloudflare-ai/cloudflare-ai-search'
import { OPENROUTER_SECTION_ID } from '../accounts/openrouter/openrouter-search'

/** Where in Settings > Accounts a provider's login or key lives; undefined opens the pane's top. */
export function settingsAccountsSectionForUtilityProvider(
  provider: UtilityModelProviderId
): string | undefined {
  switch (provider) {
    case 'cloudflare-workers-ai':
      return CLOUDFLARE_AI_SECTION_ID
    case 'openrouter':
      return OPENROUTER_SECTION_ID
    case 'minimax':
      return ACCOUNTS_SECTION_IDS.minimax
    case 'grok':
      return ACCOUNTS_SECTION_IDS.grok
    case 'antigravity':
      return ACCOUNTS_SECTION_IDS.antigravity
    case 'claude':
    case 'codex':
    case 'devin':
      return undefined
  }
}
