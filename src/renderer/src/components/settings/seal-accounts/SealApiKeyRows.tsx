import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../ui/dialog'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { SettingsRow, SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import type {
  SealApiKeyAccount,
  SealProvider
} from '../../../../../shared/seal-accounts/seal-accounts-config'

/** Stored keys show only their last characters; the secret never leaves the vault. */
export function SealApiKeyRows({
  apiKeys,
  onRemove
}: {
  apiKeys: SealApiKeyAccount[]
  onRemove: (id: string) => void
}) {
  const t = useTranslate()
  if (apiKeys.length === 0) {
    return (
      <p className="py-3 text-xs text-muted-foreground" data-settings-row="">
        {t('seal.accounts.keys.empty', 'No API keys stored.')}
      </p>
    )
  }
  return apiKeys.map((key) => (
    <SettingsRow
      key={key.id}
      label={
        <span className="flex items-center gap-2">
          <span className="truncate">{key.label}</span>
          <Badge variant="secondary">{key.provider === 'claude' ? 'Anthropic' : 'OpenAI'}</Badge>
        </span>
      }
      description={`••••${key.keyHint}`}
      control={
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('seal.accounts.keys.remove', 'Remove key')}
          onClick={() => onRemove(key.id)}
        >
          <Trash2 className="size-4" />
        </Button>
      }
    />
  ))
}

export function SealApiKeyDialog({
  open,
  onOpenChange,
  secretStorage,
  onSave
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  secretStorage: { available: boolean; protectionGap: string | null }
  onSave: (input: { provider: SealProvider; label: string; apiKey: string }) => Promise<boolean>
}) {
  const t = useTranslate()
  const [provider, setProvider] = useState<SealProvider>('claude')
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    const ok = await onSave({ provider, label: label.trim(), apiKey: apiKey.trim() })
    setSaving(false)
    if (ok) {
      setLabel('')
      setApiKey('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('seal.accounts.keys.addTitle', 'Add API key')}</DialogTitle>
          <DialogDescription>
            {secretStorage.protectionGap ??
              t(
                'seal.accounts.keys.addDescription',
                'Stored encrypted in the system keychain on the machine that runs the agent.'
              )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <SettingsSegmentedControl
            size="sm"
            value={provider}
            onChange={setProvider}
            options={[
              { value: 'claude', label: t('seal.accounts.keys.anthropic', 'Anthropic (Claude)') },
              { value: 'codex', label: t('seal.accounts.keys.openai', 'OpenAI (Codex)') }
            ]}
            ariaLabel={t('seal.accounts.policy.provider', 'Provider')}
          />
          <div className="grid gap-1">
            <Label htmlFor="seal-key-label" className="text-xs">
              {t('seal.accounts.keys.label', 'Name')}
            </Label>
            <Input id="seal-key-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seal-key-secret" className="text-xs">
              {t('seal.accounts.keys.secret', 'Key')}
            </Label>
            <Input
              id="seal-key-secret"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'claude' ? 'sk-ant-…' : 'sk-…'}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('seal.accounts.cancel', 'Cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              saving || !label.trim() || apiKey.trim().length < 8 || !secretStorage.available
            }
          >
            {t('seal.accounts.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
