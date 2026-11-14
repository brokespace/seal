import { useState } from 'react'
import { Loader2, Lock, LockOpen } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../../../ui/badge'
import { Button } from '../../../ui/button'
import { Input } from '../../../ui/input'
import { Label } from '../../../ui/label'
import { UnsealedCredentialNotice } from '../../../provider-accounts/UnsealedCredentialNotice'
import { SearchableSetting } from '../../section-layout/SearchableSetting'
import { CLOUDFLARE_AI_SEARCH_KEYWORDS } from './cloudflare-ai-search'
import type { CloudflareAiSettingsModel } from './use-cloudflare-ai-settings'

const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i

/** Write-only: the host keeps the token and never sends it back, so the fields start empty. */
export function CloudflareAiCredentialsSetting({
  model,
  editable
}: {
  model: CloudflareAiSettingsModel
  editable: boolean
}): React.JSX.Element {
  const t = useTranslate()
  const { status, busy } = model
  const [accountId, setAccountId] = useState('')
  const [apiToken, setApiToken] = useState('')
  const saved = status?.source === 'settings'
  const accountIdDraft = accountId.trim()
  const apiTokenDraft = apiToken.trim()
  const accountIdInvalid = accountIdDraft !== '' && !ACCOUNT_ID_PATTERN.test(accountIdDraft)
  // A saved or file-provided half may be kept; a first save needs both.
  const complete =
    status?.configured === true
      ? accountIdDraft !== '' || apiTokenDraft !== ''
      : accountIdDraft !== '' && apiTokenDraft !== ''
  const title = t('seal.cloudflareAi.credentials.title', 'Account ID and API token')

  const save = async (): Promise<void> => {
    const ok = await model.save({
      ...(accountIdDraft ? { accountId: accountIdDraft } : {}),
      ...(apiTokenDraft ? { apiToken: apiTokenDraft } : {})
    })
    if (ok) {
      setAccountId('')
      setApiToken('')
    }
  }

  return (
    <SearchableSetting
      title={title}
      description={t(
        'seal.cloudflareAi.credentials.description',
        'The Cloudflare account ID and a Workers AI API token.'
      )}
      keywords={CLOUDFLARE_AI_SEARCH_KEYWORDS}
      className="space-y-2 py-3"
    >
      <div className="flex items-center gap-2">
        <Label htmlFor="cloudflare-ai-account-id">{title}</Label>
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
        credentialName={t('seal.cloudflareAi.credentials.tokenName', 'The Cloudflare API token')}
      />
      <div className="flex flex-wrap gap-2">
        <Input
          id="cloudflare-ai-account-id"
          disabled={busy || !editable}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder={t('seal.cloudflareAi.credentials.accountIdPlaceholder', 'Account ID')}
          aria-invalid={accountIdInvalid}
          spellCheck={false}
          autoComplete="off"
          variant="code"
          className="min-w-40 flex-1"
        />
        <Input
          type="password"
          disabled={busy || !editable}
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
          placeholder={t('seal.cloudflareAi.credentials.tokenPlaceholder', 'API token')}
          aria-label={t('seal.cloudflareAi.credentials.tokenPlaceholder', 'API token')}
          spellCheck={false}
          autoComplete="off"
          className="min-w-40 flex-1"
        />
        <Button
          size="xs"
          onClick={() => void save()}
          disabled={busy || !editable || !complete || accountIdInvalid}
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
            onClick={() => void model.forget()}
            disabled={busy || !editable}
            className="shrink-0 self-center"
          >
            {t('seal.cloudflareAi.credentials.forget', 'Forget')}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {accountIdInvalid
          ? t(
              'seal.cloudflareAi.credentials.accountIdInvalid',
              'The account ID is 32 letters and digits, shown on the Workers AI page of the Cloudflare dashboard.'
            )
          : t(
              'seal.cloudflareAi.credentials.help',
              'Create a token with the Workers AI Read permission. It is kept in the host’s credential storage, sent only to Cloudflare, and never shown again.'
            )}
      </p>
    </SearchableSetting>
  )
}
