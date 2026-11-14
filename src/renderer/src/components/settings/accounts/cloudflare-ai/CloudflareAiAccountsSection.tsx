import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { ExternalLink, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { UtilityModelStatus } from '../../../../../../shared/utility-model/utility-model-types'
import { Button } from '../../../ui/button'
import { SettingsSwitchRow } from '../../form-controls/SettingsFormControls'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { SettingsGroup } from '../../section-layout/SettingsGroup'
import {
  usageCredentialAccessNotice,
  type UsageCredentialHost
} from '../usage/usage-credential-host'
import { CloudflareAiCredentialsSetting } from './CloudflareAiCredentialsSetting'
import { CloudflareAiModelSetting } from './CloudflareAiModelSetting'
import { CLOUDFLARE_AI_SEARCH_KEYWORDS, CLOUDFLARE_AI_SECTION_ID } from './cloudflare-ai-search'
import { useCloudflareAiSettings } from './use-cloudflare-ai-settings'
import { utilityModelFailureText } from './utility-model-failure-text'

const TOKENS_URL = 'https://dash.cloudflare.com/profile/api-tokens'

function resumeTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function sourceLine(status: UtilityModelStatus, hostLabel: string | null, t: Translate): string {
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

/** The utility model that writes session summaries, on whichever host the accounts pane points at. */
export function CloudflareAiAccountsSection({
  host
}: {
  host: UsageCredentialHost
}): React.JSX.Element {
  const t = useTranslate()
  const model = useCloudflareAiSettings(host.owner)
  const { status, summaries, access, testing, testResult } = model
  const webClient = isWebClientLocation()
  const editable = !webClient && access === 'ready'
  const accessNotice = usageCredentialAccessNotice(host, access, t)
  const configured = status?.configured === true
  const summariesTitle = t('seal.sessionSummaries.setting.title', 'Session summaries')

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
          'A small Workers AI model writes the one-line summary on each agent session. The free plan is enough.'
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
        <div className="flex items-start gap-3 py-3">
          <ShieldCheck
            className={cn(
              'mt-0.5 size-4 shrink-0',
              configured ? 'text-foreground' : 'text-muted-foreground'
            )}
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            {accessNotice ? (
              <p className="text-xs font-medium">{accessNotice}</p>
            ) : status && configured ? (
              <>
                <p className="text-xs font-medium">
                  {t('seal.cloudflareAi.status.connected', 'Account linked · …{{account}}', {
                    account: status.accountHint ?? ''
                  })}
                </p>
                <p className="text-xs text-muted-foreground">{sourceLine(status, host.label, t)}</p>
              </>
            ) : status ? (
              <>
                <p className="text-xs font-medium">
                  {t('seal.cloudflareAi.status.notConfigured', 'No Cloudflare account linked')}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(
                    'seal.cloudflareAi.status.notConfiguredHelp',
                    'Save an account ID and API token below, or put them in ~/.config/seal/cloudflare-ai.json on the host.'
                  )}
                </p>
              </>
            ) : null}
            {status?.pausedUntil ? (
              <p className="text-xs text-muted-foreground">
                {t(
                  'seal.cloudflareAi.status.paused',
                  'Cloudflare’s limit was reached. Summaries resume at {{time}}; nothing else is affected.',
                  { time: resumeTime(status.pausedUntil) }
                )}
              </p>
            ) : null}
            {testResult ? (
              <p
                role="status"
                className={cn(
                  'text-xs',
                  testResult.ok ? 'text-muted-foreground' : 'text-destructive'
                )}
              >
                {testResult.ok
                  ? testResult.usedFallback
                    ? t(
                        'seal.cloudflareAi.test.okFallback',
                        'Works: the fallback {{model}} answered in {{ms}} ms.',
                        { model: testResult.model, ms: testResult.elapsedMs }
                      )
                    : t('seal.cloudflareAi.test.ok', 'Works: {{model}} answered in {{ms}} ms.', {
                        model: testResult.model,
                        ms: testResult.elapsedMs
                      })
                  : utilityModelFailureText(testResult.failure, t)}
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="xs"
            disabled={testing || !editable || !configured}
            onClick={() => void model.test()}
            className="shrink-0"
          >
            {testing ? <Loader2 className="size-3 animate-spin" /> : null}
            {t('seal.cloudflareAi.test.button', 'Test')}
          </Button>
        </div>

        {webClient ? (
          <p className="pb-3 text-xs text-muted-foreground">
            {t(
              'seal.cloudflareAi.hostOnly',
              'Change the Cloudflare account and model in the desktop app, or in the config file on the computer running Seal.'
            )}
          </p>
        ) : null}

        <CloudflareAiCredentialsSetting model={model} editable={editable} />
        <CloudflareAiModelSetting model={model} editable={editable} />

        <SearchableSetting
          title={summariesTitle}
          description={t(
            'seal.sessionSummaries.setting.searchDescription',
            'Show a one-line AI summary on agent sessions.'
          )}
          keywords={CLOUDFLARE_AI_SEARCH_KEYWORDS}
        >
          <SettingsSwitchRow
            label={summariesTitle}
            description={
              configured
                ? t(
                    'seal.sessionSummaries.setting.description',
                    'When an agent stops or waits on a task, show one short sentence saying what it did or needs. Only the agent’s last message is sent, never tool output.'
                  )
                : t(
                    'seal.sessionSummaries.setting.needsProvider',
                    'Starts once a Cloudflare account is linked above.'
                  )
            }
            checked={summaries?.enabled ?? true}
            disabled={summaries === null}
            onChange={() => void model.setSummariesEnabled(!(summaries?.enabled ?? true))}
          />
        </SearchableSetting>
      </SettingsGroup>
    </div>
  )
}
