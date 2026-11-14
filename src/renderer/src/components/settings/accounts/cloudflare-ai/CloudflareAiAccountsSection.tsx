import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { ExternalLink, Sparkles } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { UtilityModelProviderStatus } from '../../../../../../shared/utility-model/utility-model-types'
import { SettingsGroup } from '../../section-layout/SettingsGroup'
import {
  usageCredentialAccessNotice,
  type UsageCredentialHost
} from '../usage/usage-credential-host'
import { UtilityModelAccountStatus } from '../utility-model/UtilityModelAccountStatus'
import { useUtilityModelAccount } from '../utility-model/use-utility-model-account'
import { CloudflareAiCredentialsSetting } from './CloudflareAiCredentialsSetting'
import { CLOUDFLARE_AI_SECTION_ID } from './cloudflare-ai-search'

const TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens'

function sourceLine(
  status: UtilityModelProviderStatus,
  hostLabel: string | null,
  t: Translate
): string {
  if (status.source === 'config-file') {
    return hostLabel === null
      ? t(
          'seal.cloudflareAi.status.fromFile',
          'Read from ~/.config/seal/cloudflare-ai.json on this computer.'
        )
      : t(
          'seal.cloudflareAi.status.fromFileOnHost',
          'Read from ~/.config/seal/cloudflare-ai.json on {{host}}.',
          { host: hostLabel }
        )
  }
  return hostLabel === null
    ? t('seal.cloudflareAi.status.stored', 'Stored on this computer and sent only to Cloudflare.')
    : t(
        'seal.cloudflareAi.status.storedOnHost',
        'Stored on {{host}} and sent from there only to Cloudflare.',
        { host: hostLabel }
      )
}

/** The Cloudflare Workers AI account session summaries and recaps can run on, on whichever host the accounts pane points at. */
export function CloudflareAiAccountsSection({
  host
}: {
  host: UsageCredentialHost
}): React.JSX.Element {
  const t = useTranslate()
  const model = useUtilityModelAccount(host.owner, 'cloudflare-workers-ai', {
    saveFailed: t('seal.cloudflareAi.saveFailed', 'Cloudflare AI settings were not saved.'),
    testFailed: t('seal.cloudflareAi.testFailed', 'Could not run the Cloudflare AI test.')
  })
  const { status, access } = model
  const webClient = isWebClientLocation()
  const editable = !webClient && access === 'ready'
  const accessNotice = usageCredentialAccessNotice(host, access, t)
  const configured = status?.configured === true

  return (
    <div id={CLOUDFLARE_AI_SECTION_ID} className="scroll-mt-6">
      <SettingsGroup
        title={
          <span className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {t('seal.cloudflareAi.title', 'Cloudflare AI')}
          </span>
        }
        description={t(
          'seal.cloudflareAi.subtitle',
          'A Workers AI account that session summaries and recaps can run on. The free plan is enough. Choose the provider and model in Session summaries & recaps.'
        )}
        action={
          <a
            href={TOKENS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('seal.cloudflareAi.tokensLink', 'Get API token')}
            <ExternalLink className="size-3" />
          </a>
        }
      >
        <UtilityModelAccountStatus
          provider="cloudflare-workers-ai"
          configured={configured}
          title={
            accessNotice ??
            (status === null
              ? null
              : configured
                ? t('seal.cloudflareAi.status.connected', 'Account linked · …{{account}}', {
                    account: status.accountHint ?? ''
                  })
                : t('seal.cloudflareAi.status.notConfigured', 'No Cloudflare account linked'))
          }
          detail={
            accessNotice || status === null
              ? null
              : configured
                ? sourceLine(status, host.label, t)
                : t(
                    'seal.cloudflareAi.status.notConfiguredHelp',
                    'Save an account ID and API token below, or put them in ~/.config/seal/cloudflare-ai.json on the host.'
                  )
          }
          pausedUntil={status?.pausedUntil ?? null}
          testResult={model.testResult}
          testing={model.testing}
          canTest={editable && configured}
          onTest={() => void model.test()}
        />

        {webClient ? (
          <p className="pb-3 text-xs text-muted-foreground">
            {t(
              'seal.cloudflareAi.hostOnly',
              'Change the Cloudflare account in the desktop app, or in the config file on the computer running Seal.'
            )}
          </p>
        ) : null}

        <CloudflareAiCredentialsSetting model={model} editable={editable} />
      </SettingsGroup>
    </div>
  )
}
