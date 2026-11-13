import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../ui/button'
import { Checkbox } from '../../ui/checkbox'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/select'
import { SettingsSegmentedControl } from '../form-controls/SettingsFormControls'
import type { SealAccountCandidate } from '../../../../../shared/seal-accounts/seal-account-candidates'
import type { SealProvider } from '../../../../../shared/seal-accounts/seal-accounts-config'

export type SealPolicyDraft = {
  scope: 'project' | 'machine'
  target: string
  provider: SealProvider
  label?: string
  allow: string[]
  default: string | null
}

type SealPolicyRuleDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  candidates: Record<SealProvider, SealAccountCandidate[]>
  machineKey: string
  onSave: (draft: SealPolicyDraft) => Promise<boolean>
}

const NO_DEFAULT = '__none__'

export function SealPolicyRuleDialog({
  open,
  onOpenChange,
  candidates,
  machineKey,
  onSave
}: SealPolicyRuleDialogProps) {
  const t = useTranslate()
  const [scope, setScope] = useState<'project' | 'machine'>('project')
  const [target, setTarget] = useState('')
  const [label, setLabel] = useState('')
  const [provider, setProvider] = useState<SealProvider>('claude')
  const [allow, setAllow] = useState<string[]>([])
  const [defaultKey, setDefaultKey] = useState<string>(NO_DEFAULT)
  const accounts = candidates[provider]

  const reset = (): void => {
    setTarget('')
    setLabel('')
    setAllow([])
    setDefaultKey(NO_DEFAULT)
  }

  const save = async (): Promise<void> => {
    const ok = await onSave({
      scope,
      target: target.trim() || (scope === 'machine' ? machineKey : ''),
      provider,
      ...(label.trim() ? { label: label.trim() } : {}),
      allow,
      default: defaultKey === NO_DEFAULT ? null : defaultKey
    })
    if (ok) {
      reset()
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('seal.accounts.policy.addTitle', 'Account rule')}</DialogTitle>
          <DialogDescription>
            {t(
              'seal.accounts.policy.addDescription',
              'Limit which accounts a project or machine may use, and which it prefers.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <SettingsSegmentedControl
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'project', label: t('seal.accounts.policy.project', 'Project') },
                { value: 'machine', label: t('seal.accounts.policy.machine', 'Machine') }
              ]}
              ariaLabel={t('seal.accounts.policy.scope', 'Applies to')}
            />
            <SettingsSegmentedControl
              size="sm"
              value={provider}
              onChange={(next) => {
                setProvider(next)
                setAllow([])
                setDefaultKey(NO_DEFAULT)
              }}
              options={[
                { value: 'claude', label: t('seal.accounts.provider.claude', 'Claude') },
                { value: 'codex', label: t('seal.accounts.provider.codex', 'Codex') }
              ]}
              ariaLabel={t('seal.accounts.policy.provider', 'Provider')}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seal-rule-target">
              {scope === 'project'
                ? t('seal.accounts.policy.projectMatch', 'Repo or folder')
                : t('seal.accounts.policy.machineMatch', 'Machine')}
            </Label>
            <Input
              id="seal-rule-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder={
                scope === 'project'
                  ? t('seal.accounts.policy.projectPlaceholder', 'github.com/acme/*')
                  : machineKey
              }
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seal-rule-label">
              {t('seal.accounts.policy.label', 'Name (optional)')}
            </Label>
            <Input id="seal-rule-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>
              {t('seal.accounts.policy.allowed', 'Allowed accounts (none checked allows all)')}
            </Label>
            {accounts.map((candidate) => (
              <label key={candidate.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={allow.includes(candidate.key)}
                  onCheckedChange={(checked) =>
                    setAllow((current) =>
                      checked
                        ? [...current, candidate.key]
                        : current.filter((key) => key !== candidate.key)
                    )
                  }
                />
                <span className="truncate">{candidate.label}</span>
              </label>
            ))}
          </div>
          <div className="grid gap-1">
            <Label>{t('seal.accounts.policy.default', 'Default')}</Label>
            <Select value={defaultKey} onValueChange={setDefaultKey}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_DEFAULT}>
                  {t('seal.accounts.policy.noDefault', 'Best available')}
                </SelectItem>
                {accounts.map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('seal.accounts.cancel', 'Cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={scope === 'project' && !target.trim()}>
            {t('seal.accounts.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
