import type { Translate } from '@/i18n/use-translate'
import { utilityModelProvider } from '../../../../../../shared/utility-model/utility-model-provider-catalog'
import type {
  UtilityModelFailure,
  UtilityModelProviderId
} from '../../../../../../shared/utility-model/utility-model-types'

/** What went wrong, in words a person can act on. Provider text is shown only where it adds something. */
export function utilityModelFailureText(
  failure: UtilityModelFailure,
  t: Translate,
  providerId: UtilityModelProviderId = 'cloudflare-workers-ai'
): string {
  const { label: provider, kind } = utilityModelProvider(providerId)
  const model = failure.model ?? t('seal.cloudflareAi.failure.thisModel', 'This model')
  const cloudflare = providerId === 'cloudflare-workers-ai'
  switch (failure.kind) {
    case 'not-configured':
      if (cloudflare) {
        return t(
          'seal.cloudflareAi.failure.notConfigured',
          'Add an account ID and API token first.'
        )
      }
      return kind === 'agent-cli'
        ? t(
            'seal.utilityModel.failure.cliMissing',
            'The {{provider}} CLI was not found on this host.',
            { provider }
          )
        : t(
            'seal.utilityModel.failure.keyMissing',
            'Save an API key for {{provider}} in Settings > Accounts first.',
            { provider }
          )
    case 'unauthorized':
      if (cloudflare) {
        return t(
          'seal.cloudflareAi.failure.unauthorized',
          'Cloudflare rejected the credentials. Check the account ID, and that the token has the Workers AI permission.'
        )
      }
      return kind === 'agent-cli'
        ? t(
            'seal.utilityModel.failure.cliSignedOut',
            '{{provider}} is not signed in on this host: {{message}}',
            { provider, message: failure.message }
          )
        : t('seal.utilityModel.failure.unauthorized', '{{provider}} rejected the API key.', {
            provider
          })
    case 'plan-unavailable':
      return cloudflare
        ? t(
            'seal.cloudflareAi.failure.planUnavailable',
            '{{model}} is not available on this account’s Workers plan (it needs a paid plan).',
            { model }
          )
        : t(
            'seal.utilityModel.failure.planUnavailable',
            '{{model}} needs credits this {{provider}} account does not have.',
            { model, provider }
          )
    case 'rate-limited':
      return cloudflare
        ? t(
            'seal.cloudflareAi.failure.rateLimited',
            'Cloudflare’s rate limit or daily free allocation was reached.'
          )
        : t('seal.utilityModel.failure.rateLimited', '{{provider}}’s rate limit was reached.', {
            provider
          })
    case 'model-not-found':
      return cloudflare
        ? t('seal.cloudflareAi.failure.modelNotFound', '{{model}} does not exist on Workers AI.', {
            model
          })
        : t(
            'seal.utilityModel.failure.modelNotFound',
            '{{model}} is not a model {{provider}} offers.',
            { model, provider }
          )
    case 'network':
      return failure.message
    case 'bad-response':
      return cloudflare
        ? t(
            'seal.cloudflareAi.failure.badResponse',
            'Cloudflare answered unexpectedly: {{message}}',
            { message: failure.message }
          )
        : t('seal.utilityModel.failure.badResponse', '{{provider}} failed: {{message}}', {
            provider,
            message: failure.message
          })
  }
}
