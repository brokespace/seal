import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealProvider } from '../../../../../shared/seal-accounts/seal-accounts-config'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'

export type SealSecretInput =
  | { kind: 'api-key'; provider: SealProvider; label: string; secret: string }
  | { kind: 'setup-token'; label: string; secret: string }

type SealSecretFormProps = {
  kind: SealSecretInput['kind']
  secretStorage: { available: boolean; protectionGap: string | null }
  onSave: (input: SealSecretInput) => Promise<boolean>
  onCancel: () => void
}

/** Names and stores a pasted secret: an API key, or a Claude setup token. */
export function SealSecretForm({
  kind,
  secretStorage,
  onSave,
  onCancel
}: SealSecretFormProps): React.JSX.Element {
  const t = useTranslate()
  const [provider, setProvider] = useState<SealProvider>('claude')
  const [label, setLabel] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const token = kind === 'setup-token'
  const trimmed = secret.trim()
  const wrongKind = token && trimmed.length >= 10 && !trimmed.startsWith('sk-ant-oat')

  const save = async (): Promise<void> => {
    setSaving(true)
    await onSave(
      token
        ? { kind, label: label.trim(), secret: trimmed }
        : { kind, provider, label: label.trim(), secret: trimmed }
    )
    setSaving(false)
  }

  return (
    <form
      className="grid gap-4"
      data-slot="seal-secret-form"
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <p className="text-xs text-muted-foreground">
        {secretStorage.protectionGap ??
          (token
            ? t(
                'seal.accounts.secret.tokenHelp',
                'Run `claude setup-token` in a terminal where that account is signed in, then paste the token it prints. It is sealed in this computer’s keychain and used only for sessions Seal starts.'
              )
            : t(
                'seal.accounts.secret.keyHelp',
                'Sealed in this computer’s keychain. Keys never leave the machine they were added on.'
              ))}
      </p>
      {token ? null : (
        <SettingsSegmentedControl
          size="sm"
          value={provider}
          onChange={setProvider}
          options={[
            { value: 'claude', label: t('seal.accounts.secret.anthropic', 'Anthropic (Claude)') },
            { value: 'codex', label: t('seal.accounts.secret.openai', 'OpenAI (Codex)') }
          ]}
          ariaLabel={t('seal.accounts.secret.provider', 'Provider')}
        />
      )}
      <div className="grid gap-1">
        <Label htmlFor="seal-secret-label">{t('seal.accounts.secret.label', 'Name')}</Label>
        <Input
          id="seal-secret-label"
          value={label}
          maxLength={80}
          placeholder={
            token
              ? t('seal.accounts.secret.tokenLabelPlaceholder', 'Work subscription')
              : t('seal.accounts.secret.keyLabelPlaceholder', 'Team key')
          }
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="seal-secret-value">
          {token
            ? t('seal.accounts.secret.token', 'Setup token')
            : t('seal.accounts.secret.key', 'Key')}
        </Label>
        <Input
          id="seal-secret-value"
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={wrongKind}
          value={secret}
          placeholder={
            token
              ? t('seal.accounts.secret.tokenPlaceholder', 'sk-ant-oat01-…')
              : provider === 'claude'
                ? t('seal.accounts.secret.anthropicPlaceholder', 'sk-ant-api03-…')
                : t('seal.accounts.secret.openaiPlaceholder', 'sk-…')
          }
          onChange={(event) => setSecret(event.target.value)}
        />
        {wrongKind ? (
          <p role="alert" className="text-xs text-destructive">
            {t(
              'seal.accounts.secret.notSetupToken',
              'Setup tokens start with sk-ant-oat. For an API key, choose API key instead.'
            )}
          </p>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('seal.accounts.cancel', 'Cancel')}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={
            saving || !label.trim() || trimmed.length < 8 || wrongKind || !secretStorage.available
          }
        >
          {token
            ? t('seal.accounts.secret.saveToken', 'Add token')
            : t('seal.accounts.secret.saveKey', 'Add key')}
        </Button>
      </div>
    </form>
  )
}
