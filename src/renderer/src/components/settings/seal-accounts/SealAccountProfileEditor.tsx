import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../../ui/button'
import { Input } from '../../ui/input'
import { Label } from '../../ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Switch } from '../../ui/switch'
import type { SealAccountProfile } from '../../../../../shared/seal-accounts/seal-accounts-config'

type SealAccountProfileEditorProps = {
  accountLabel: string
  profile: SealAccountProfile | undefined
  onSave: (profile: SealAccountProfile) => Promise<boolean>
}

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function SealAccountProfileEditor({
  accountLabel,
  profile,
  onSave
}: SealAccountProfileEditorProps) {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [alias, setAlias] = useState(profile?.alias ?? '')
  const [plan, setPlan] = useState(profile?.plan ?? '')
  const [priority, setPriority] = useState(profile?.priority?.toString() ?? '')
  const [session, setSession] = useState(profile?.sessionThreshold?.toString() ?? '')
  const [weekly, setWeekly] = useState(profile?.weeklyThreshold?.toString() ?? '')
  const [disabled, setDisabled] = useState(profile?.disabled === true)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setSaving(true)
    const ok = await onSave({
      ...(alias.trim() ? { alias: alias.trim() } : {}),
      ...(plan.trim() ? { plan: plan.trim() } : {}),
      priority: optionalNumber(priority),
      sessionThreshold: optionalNumber(session),
      weeklyThreshold: optionalNumber(weekly),
      ...(disabled ? { disabled } : {})
    })
    setSaving(false)
    if (ok) {
      setOpen(false)
    }
  }

  const field = (
    id: string,
    label: string,
    value: string,
    set: (value: string) => void,
    placeholder?: string
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => set(event.target.value)}
      />
    </div>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('seal.accounts.profile.edit', 'Edit {{value0}}', { value0: accountLabel })}
        >
          <Settings2 className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {field(
            'seal-alias',
            t('seal.accounts.profile.alias', 'Alias'),
            alias,
            setAlias,
            accountLabel
          )}
          {field(
            'seal-plan',
            t('seal.accounts.profile.plan', 'Plan'),
            plan,
            setPlan,
            t('seal.accounts.profile.planPlaceholder', 'Detected from usage')
          )}
          {field(
            'seal-priority',
            t('seal.accounts.profile.priority', 'Priority (lower first)'),
            priority,
            setPriority,
            '100'
          )}
          <div className="grid grid-cols-2 gap-2">
            {field(
              'seal-session',
              t('seal.accounts.profile.sessionThreshold', '5h limit %'),
              session,
              setSession,
              t('seal.accounts.profile.default', 'Default')
            )}
            {field(
              'seal-weekly',
              t('seal.accounts.profile.weeklyThreshold', '7d limit %'),
              weekly,
              setWeekly,
              t('seal.accounts.profile.default', 'Default')
            )}
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="seal-disabled" className="text-xs">
              {t('seal.accounts.profile.disabled', 'Never pick automatically')}
            </Label>
            <Switch id="seal-disabled" checked={disabled} onCheckedChange={setDisabled} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('seal.accounts.cancel', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {t('seal.accounts.save', 'Save')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
