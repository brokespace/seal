import { useState } from 'react'
import { isWebClientLocation } from '@/app-shell/platform/web-client-location'
import { ExternalLink, Loader2, Lock, LockOpen, Route } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import type { UtilityModelProviderStatus } from '../../../../../../shared/utility-model/utility-model-types'
import { UnsealedCredentialNotice } from '../../../provider-accounts/UnsealedCredentialNotice'
import { Badge } from '../../../ui/badge'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { Label } from '../../../ui/label'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { SettingsGroup } from '../../section-layout/SettingsGroup'
import {
  usageCredentialAccessNotice,
  type UsageCredentialHost
} from '../usage/usage-credential-host'
import { UtilityModelAccountStatus } from '../utility-model/UtilityModelAccountStatus'
import { useUtilityModelAccount } from '../utility-model/use-utility-model-account'
import { OPENROUTER_SEARCH_KEYWORDS, OPENROUTER_SECTION_ID } from './openrouter-search'

const KEYS_URL = 'https://openrouter.ai/settings/keys'
const MIN_KEY_LENGTH = 20

function sourceLine(
  status: UtilityModelProviderStatus,
  hostLabel: string | null,
  t: Translate
): string {
  if (status.source === 'environment') {
    return hostLabel === null
      ? t(
          'seal.openRouter.status.fromEnvironment',
          'Read from OPENROUTER_API_KEY in the environment Seal started with.'
        )
      : t(
          'seal.openRouter.status.fromEnvironmentOnHost',
          'Read from OPENROUTER_API_KEY in the environment Seal started with on {{host}}.',
          { host: hostLabel }
        )
  }
  return hostLabel === null
    ? t('seal.openRouter.status.stored', 'Stored on this computer and sent only to OpenRouter.')
    : t(
        'seal.openRouter.status.storedOnHost',
        'Stored on {{host}} and sent from there only to OpenRouter.',
        { host: hostLabel }
      )
}

/** The OpenRouter key session summaries and recaps can run on, on whichever host the accounts pane points at. */
export function OpenRouterAccountsSection({
  host
}: {
  host: UsageCredentialHost
}): React.JSX.Element {
  const t = useTranslate()
  const model = useUtilityModelAccount(host.owner, 'openrouter', {
    saveFailed: t('seal.openRouter.saveFailed', 'The OpenRouter key was not saved.'),
    testFailed: t('seal.openRouter.testFailed', 'Could not run the OpenRouter test.')
  })
  const { status, access, busy } = model
  const [apiKey, setApiKey] = useState('')
  const webClient = isWebClientLocation()
  const editable = !webClient && access === 'ready'
  const accessNotice = usageCredentialAccessNotice(host, access, t)
  const configured = status?.configured === true
  const saved = status?.source === 'settings'
  const draft = apiKey.trim()
  const keyTitle = t('seal.openRouter.key.title', 'API key')

  const save = async (): Promise<void> => {
    if (await model.change('utilityModel.setOpenRouter', { apiKey: draft })) {
      setApiKey('')
    }
  }

  return (
    <div id={OPENROUTER_SECTION_ID} className="scroll-mt-6">
      <SettingsGroup
        title={
          <span className="flex items-center gap-2">
            <Route className="size-4" />
            {t('seal.openRouter.title', 'OpenRouter')}
          </span>
        }
        description={t(
          'seal.openRouter.subtitle',
          'One key for many models, some of them free. Session summaries and recaps can run on it; choose the model in Session summaries & recaps.'
        )}
        action={
          <a
            href={KEYS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {t('seal.openRouter.keysLink', 'Get API key')}
            <ExternalLink className="size-3" />
          </a>
        }
      >
        <UtilityModelAccountStatus
          provider="openrouter"
          configured={configured}
          title={
            accessNotice ??
            (status === null
              ? null
              : configured
                ? t('seal.openRouter.status.connected', 'Key saved · …{{key}}', {
                    key: status.accountHint ?? ''
                  })
                : t('seal.openRouter.status.notConfigured', 'No OpenRouter key saved'))
          }
          detail={
            accessNotice || status === null
              ? null
              : configured
                ? sourceLine(status, host.label, t)
                : t(
                    'seal.openRouter.status.notConfiguredHelp',
                    'Save a key below, or start Seal with OPENROUTER_API_KEY set on the host.'
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
              'seal.openRouter.hostOnly',
              'Change the OpenRouter key in the desktop app, or in the environment of the computer running Seal.'
            )}
          </p>
        ) : null}

        <SearchableSetting
          title={keyTitle}
          description={t('seal.openRouter.key.description', 'The OpenRouter API key.')}
          keywords={OPENROUTER_SEARCH_KEYWORDS}
          className="space-y-2 py-3"
        >
          <div className="flex items-center gap-2">
            <Label htmlFor="openrouter-api-key">{keyTitle}</Label>
            {status ? (
              <Badge variant={saved ? 'secondary' : 'outline'}>
                {saved ? <Lock className="size-3" /> : <LockOpen className="size-3" />}
                {saved
                  ? t('seal.cloudflareAi.credentials.saved', 'Saved')
                  : t('seal.cloudflareAi.credentials.notSaved', 'Not saved')}
              </Badge>
            ) : null}
          </div>
          <UnsealedCredentialNotice
            protection={status?.tokenProtection ?? null}
            credentialName={t('seal.openRouter.key.name', 'The OpenRouter API key')}
          />
          <div className="flex flex-wrap gap-2">
            <Input
              id="openrouter-api-key"
              type="password"
              disabled={busy || !editable}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={t('seal.openRouter.key.placeholder', 'sk-or-…')}
              spellCheck={false}
              autoComplete="off"
              className="min-w-40 flex-1"
            />
            <Button
              size="xs"
              onClick={() => void save()}
              disabled={busy || !editable || draft.length < MIN_KEY_LENGTH || /\s/.test(draft)}
              className="shrink-0 self-center"
            >
              {busy ? <Loader2 className="size-3 animate-spin" /> : null}
              {saved
                ? t('seal.cloudflareAi.credentials.replace', 'Replace')
                : t('seal.cloudflareAi.credentials.save', 'Save')}
            </Button>
            {saved ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void model.change('utilityModel.clearOpenRouter')}
                disabled={busy || !editable}
                className="shrink-0 self-center"
              >
                {t('seal.cloudflareAi.credentials.forget', 'Forget')}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {t(
              'seal.openRouter.key.help',
              'It is kept in the host’s credential storage, sent only to OpenRouter, and never shown again. Free models need no credits but have a daily request limit.'
            )}
          </p>
        </SearchableSetting>
      </SettingsGroup>
    </div>
  )
}
