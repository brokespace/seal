import type { Translate } from '@/i18n/use-translate'
import type { UtilityModelFailure } from '../../../../../../shared/utility-model/utility-model-types'

/** What went wrong, in words a person can act on. Provider text is shown only where it adds something. */
export function utilityModelFailureText(failure: UtilityModelFailure, t: Translate): string {
  const model = failure.model ?? t('seal.cloudflareAi.failure.thisModel', 'This model')
  switch (failure.kind) {
    case 'not-configured':
      return t('seal.cloudflareAi.failure.notConfigured', 'Add an account ID and API token first.')
    case 'unauthorized':
      return t(
        'seal.cloudflareAi.failure.unauthorized',
        'Cloudflare rejected the credentials. Check the account ID, and that the token has the Workers AI permission.'
      )
    case 'plan-unavailable':
      return t(
        'seal.cloudflareAi.failure.planUnavailable',
        '{{model}} is not available on this account’s Workers plan (it needs a paid plan).',
        { model }
      )
    case 'rate-limited':
      return t(
        'seal.cloudflareAi.failure.rateLimited',
        'Cloudflare’s rate limit or daily free allocation was reached.'
      )
    case 'model-not-found':
      return t(
        'seal.cloudflareAi.failure.modelNotFound',
        '{{model}} does not exist on Workers AI.',
        {
          model
        }
      )
    case 'network':
      return failure.message
    case 'bad-response':
      return t(
        'seal.cloudflareAi.failure.badResponse',
        'Cloudflare answered unexpectedly: {{message}}',
        { message: failure.message }
      )
  }
}
