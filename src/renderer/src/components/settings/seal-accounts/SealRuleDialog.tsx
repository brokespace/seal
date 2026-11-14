import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealProvider } from '../../../../../shared/seal-accounts/seal-accounts-config'
import type {
  SealFleetAccount,
  SealFleetMachine
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { HostCombobox } from '../../host-picker/HostCombobox'
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
import { sealMachineRuleKey, type SealRuleDraft, type SealRuleRow } from './seal-rule-rows'

const BEST_AVAILABLE = '__best__'

type SealRuleDialogProps = {
  /** The rule being edited; null to add one. What a rule applies to cannot change once saved. */
  rule: SealRuleRow | null
  accounts: readonly SealFleetAccount[]
  machines: readonly SealFleetMachine[]
  homeMachineKey: string
  onOpenChange: (open: boolean) => void
  onSave: (draft: SealRuleDraft) => Promise<boolean>
}

/** One rule, read top to bottom: where it applies, which accounts it allows, which it prefers. */
export function SealRuleDialog({
  rule,
  accounts,
  machines,
  homeMachineKey,
  onOpenChange,
  onSave
}: SealRuleDialogProps): React.JSX.Element {
  const t = useTranslate()
  const [scope, setScope] = useState<'project' | 'machine'>(rule?.scope ?? 'project')
  const [provider, setProvider] = useState<SealProvider>(rule?.provider ?? 'claude')
  const [project, setProject] = useState(rule?.scope === 'project' ? rule.target : '')
  const [machine, setMachine] = useState(rule?.scope === 'machine' ? rule.target : homeMachineKey)
  const [label, setLabel] = useState(rule?.label ?? '')
  const [allow, setAllow] = useState<string[]>(rule?.policy.allow ?? [])
  const [preferred, setPreferred] = useState<string>(rule?.policy.default ?? BEST_AVAILABLE)
  const [saving, setSaving] = useState(false)
  const choices = accounts.filter((account) => account.provider === provider)
  const preferable = allow.length > 0 ? choices.filter((a) => allow.includes(a.key)) : choices
  const paired = machines.map((entry) => ({
    id: sealMachineRuleKey(entry, homeMachineKey),
    label: entry.label
  }))
  // A saved rule may name a machine that is no longer paired; keep it selectable.
  const machineOptions = paired.some((entry) => entry.id === machine)
    ? paired
    : [...paired, { id: machine, label: machine }]
  const target = scope === 'project' ? project.trim() : machine

  const changeProvider = (next: SealProvider): void => {
    setProvider(next)
    setAllow([])
    setPreferred(BEST_AVAILABLE)
  }
  const toggle = (key: string, checked: boolean): void => {
    const next = checked ? [...allow, key] : allow.filter((entry) => entry !== key)
    setAllow(next)
    if (next.length > 0 && preferred !== BEST_AVAILABLE && !next.includes(preferred)) {
      setPreferred(BEST_AVAILABLE)
    }
  }
  const save = async (): Promise<void> => {
    setSaving(true)
    const ok = await onSave({
      scope,
      target,
      provider,
      ...(scope === 'project' && label.trim() ? { label: label.trim() } : {}),
      allow,
      default: preferred === BEST_AVAILABLE ? null : preferred
    })
    setSaving(false)
    if (ok) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-slot="seal-rule-dialog">
        <DialogHeader>
          <DialogTitle>
            {rule
              ? t('seal.accounts.rules.editTitle', 'Edit rule')
              : t('seal.accounts.rules.addTitle', 'Add rule')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'seal.accounts.rules.dialogDescription',
              'A project rule narrows what its machine allows. Sessions already running are not moved.'
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>{t('seal.accounts.rules.appliesTo', 'Applies to')}</Label>
            {rule ? (
              <p className="text-sm text-muted-foreground">
                {scope === 'project'
                  ? t('seal.accounts.rules.project', 'Project')
                  : t('seal.accounts.rules.machine', 'Machine')}
                {' · '}
                {provider === 'claude'
                  ? t('seal.accounts.group.claude', 'Claude')
                  : t('seal.accounts.group.codex', 'Codex')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <SettingsSegmentedControl
                  size="sm"
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'project', label: t('seal.accounts.rules.project', 'Project') },
                    { value: 'machine', label: t('seal.accounts.rules.machine', 'Machine') }
                  ]}
                  ariaLabel={t('seal.accounts.rules.appliesTo', 'Applies to')}
                />
                <SettingsSegmentedControl
                  size="sm"
                  value={provider}
                  onChange={changeProvider}
                  options={[
                    { value: 'claude', label: t('seal.accounts.group.claude', 'Claude') },
                    { value: 'codex', label: t('seal.accounts.group.codex', 'Codex') }
                  ]}
                  ariaLabel={t('seal.accounts.rules.provider', 'Provider')}
                />
              </div>
            )}
          </div>
          {scope === 'project' ? (
            <>
              <div className="grid gap-1">
                <Label htmlFor="seal-rule-project">
                  {t('seal.accounts.rules.projectMatch', 'Repo or folder')}
                </Label>
                <Input
                  id="seal-rule-project"
                  value={project}
                  disabled={rule !== null}
                  placeholder={t('seal.accounts.rules.projectPlaceholder', 'github.com/acme/*')}
                  onChange={(event) => setProject(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    'seal.accounts.rules.projectHelp',
                    'A git remote such as github.com/owner/repo, a repo path, or a folder name. Use * to match many.'
                  )}
                </p>
              </div>
              <div className="grid gap-1">
                <Label htmlFor="seal-rule-label">
                  {t('seal.accounts.rules.name', 'Name (optional)')}
                </Label>
                <Input
                  id="seal-rule-label"
                  value={label}
                  maxLength={120}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="grid gap-1">
              <Label htmlFor="seal-rule-machine">
                {t('seal.accounts.rules.machine', 'Machine')}
              </Label>
              <HostCombobox
                id="seal-rule-machine"
                size="sm"
                value={machine}
                onChange={setMachine}
                options={machineOptions}
                disabled={rule !== null}
              />
            </div>
          )}
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm font-medium">
              {t('seal.accounts.rules.allowed', 'Accounts it may use')}
            </legend>
            {choices.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('seal.accounts.rules.noAccounts', 'Add an account for this provider first.')}
              </p>
            ) : (
              choices.map((account) => (
                <label key={account.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={allow.includes(account.key)}
                    onCheckedChange={(checked) => toggle(account.key, checked === true)}
                  />
                  <span className="truncate">{account.candidate.label}</span>
                </label>
              ))
            )}
            <p className="text-xs text-muted-foreground">
              {allow.length === 0
                ? t('seal.accounts.rules.allowedAll', 'Nothing checked: every account is allowed.')
                : t('seal.accounts.rules.allowedSome', 'Only the checked accounts are allowed.')}
            </p>
          </fieldset>
          <div className="grid gap-1">
            <Label>{t('seal.accounts.rules.preferred', 'Preferred account')}</Label>
            <Select value={preferred} onValueChange={setPreferred}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BEST_AVAILABLE}>
                  {t('seal.accounts.rules.bestAvailable', 'The one with the most headroom')}
                </SelectItem>
                {preferable.map((account) => (
                  <SelectItem key={account.key} value={account.key}>
                    {account.candidate.label}
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
          <Button
            onClick={() => void save()}
            disabled={saving || !target}
            data-slot="seal-rule-save"
          >
            {t('seal.accounts.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
