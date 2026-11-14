import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealAccountProfile } from '../../../../../shared/seal-accounts/seal-accounts-config'
import type { SealFleetAccount } from '../../../../../shared/seal-accounts/seal-fleet-overview'
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
import { Switch } from '../../ui/switch'

type SealEditAccountDialogProps = {
  account: SealFleetAccount
  profile: SealAccountProfile | undefined
  onOpenChange: (open: boolean) => void
  onSave: (profile: SealAccountProfile) => Promise<boolean>
}

function percent(value: string): number | undefined {
  const parsed = Number(value.trim())
  return value.trim() && Number.isFinite(parsed) && parsed >= 1 && parsed <= 100
    ? Math.round(parsed)
    : undefined
}

/** Renames an account and sets the limits and plan label that apply to it alone. */
export function SealEditAccountDialog({
  account,
  profile,
  onOpenChange,
  onSave
}: SealEditAccountDialogProps): React.JSX.Element {
  const t = useTranslate()
  const { candidate } = account
  const [alias, setAlias] = useState(profile?.alias ?? '')
  const [plan, setPlan] = useState(profile?.plan ?? '')
  const [session, setSession] = useState(profile?.sessionThreshold?.toString() ?? '')
  const [weekly, setWeekly] = useState(profile?.weeklyThreshold?.toString() ?? '')
  const [disabled, setDisabled] = useState(profile?.disabled === true)
  const [saving, setSaving] = useState(false)
  const tracksUsage = candidate.kind !== 'api-key'

  const save = async (): Promise<void> => {
    setSaving(true)
    const ok = await onSave({
      ...(alias.trim() ? { alias: alias.trim() } : {}),
      ...(plan.trim() ? { plan: plan.trim() } : {}),
      // Priority is set by dragging the card; keep whatever it has.
      ...(profile?.priority !== undefined ? { priority: profile.priority } : {}),
      ...(percent(session) !== undefined ? { sessionThreshold: percent(session) } : {}),
      ...(percent(weekly) !== undefined ? { weeklyThreshold: percent(weekly) } : {}),
      ...(disabled ? { disabled } : {})
    })
    setSaving(false)
    if (ok) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-slot="seal-edit-account-dialog">
        <DialogHeader>
          <DialogTitle>{t('seal.accounts.edit.title', 'Rename and limits')}</DialogTitle>
          <DialogDescription>{candidate.email ?? candidate.label}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          <div className="grid gap-1">
            <Label htmlFor="seal-edit-alias">{t('seal.accounts.edit.alias', 'Name')}</Label>
            <Input
              id="seal-edit-alias"
              value={alias}
              maxLength={80}
              placeholder={candidate.email ?? candidate.label}
              onChange={(event) => setAlias(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                'seal.accounts.edit.aliasHelp',
                'Shown everywhere instead of the email, and accepted by `seal account` commands.'
              )}
            </p>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="seal-edit-plan">{t('seal.accounts.edit.plan', 'Plan label')}</Label>
            <Input
              id="seal-edit-plan"
              value={plan}
              maxLength={80}
              placeholder={
                candidate.limits?.planType ??
                t('seal.accounts.edit.planPlaceholder', 'e.g. Max 20x')
              }
              onChange={(event) => setPlan(event.target.value)}
            />
          </div>
          {tracksUsage ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="seal-edit-session">
                  {t('seal.accounts.edit.sessionLimit', 'Swap at 5h usage (%)')}
                </Label>
                <Input
                  id="seal-edit-session"
                  inputMode="numeric"
                  value={session}
                  placeholder={t('seal.accounts.edit.useDefault', 'Auto-swap default')}
                  onChange={(event) => setSession(event.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="seal-edit-weekly">
                  {t('seal.accounts.edit.weeklyLimit', 'Swap at 7d usage (%)')}
                </Label>
                <Input
                  id="seal-edit-weekly"
                  inputMode="numeric"
                  value={weekly}
                  placeholder={t('seal.accounts.edit.useDefault', 'Auto-swap default')}
                  onChange={(event) => setWeekly(event.target.value)}
                />
              </div>
            </div>
          ) : null}
          <div className="flex items-start justify-between gap-4">
            <div className="grid gap-0.5">
              <Label htmlFor="seal-edit-disabled">
                {t('seal.accounts.edit.manualOnly', 'Manual only')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t(
                  'seal.accounts.edit.manualOnlyHelp',
                  'Auto-swap and rules never pick it; you can still choose it yourself.'
                )}
              </p>
            </div>
            <Switch id="seal-edit-disabled" checked={disabled} onCheckedChange={setDisabled} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('seal.accounts.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {t('seal.accounts.save', 'Save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
