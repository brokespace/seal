import { useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealFleetAccount } from '../../../../../shared/seal-accounts/seal-fleet-overview'
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

export type SealRemoveAccountChoice = {
  /** Also sign this computer's own CLI out. */
  logout: boolean
  /** Other machines to remove the login from as well. */
  machineIds: string[]
}

type SealRemoveAccountDialogProps = {
  account: SealFleetAccount
  onOpenChange: (open: boolean) => void
  onConfirm: (choice: SealRemoveAccountChoice) => Promise<boolean>
}

/** Confirms a removal and says exactly what it does to this computer's own CLI login. */
export function SealRemoveAccountDialog({
  account,
  onOpenChange,
  onConfirm
}: SealRemoveAccountDialogProps): React.JSX.Element {
  const t = useTranslate()
  const { candidate } = account
  const cli = candidate.provider === 'claude' ? 'claude' : 'codex'
  // A machine without a Seal server cannot be asked to drop a login.
  const others = account.machines.filter((machine) => !machine.home && machine.reported)
  const leftBehind = account.machines.filter((machine) => !machine.reported)
  const [machineIds, setMachineIds] = useState<string[]>(() =>
    others.map((machine) => machine.machineId)
  )
  const [busy, setBusy] = useState(false)
  const systemLogin = account.onHome && candidate.systemLogin === true
  const secret = candidate.kind === 'api-key'

  const confirm = async (logout: boolean): Promise<void> => {
    setBusy(true)
    const ok = await onConfirm({ logout, machineIds })
    setBusy(false)
    if (ok) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent surface="security" className="sm:max-w-md" data-slot="seal-remove-dialog">
        <DialogHeader>
          <DialogTitle>
            {t('seal.accounts.remove.title', 'Remove {{value0}}?', { value0: candidate.label })}
          </DialogTitle>
          <DialogDescription>
            {secret
              ? t(
                  'seal.accounts.remove.secret',
                  'Seal deletes this secret from the keychain and drops it from every rule. Sessions already running on it keep going.'
                )
              : candidate.kind === 'system'
                ? t(
                    'seal.accounts.remove.systemOnly',
                    'Seal stops listing and using this account and drops it from every rule. Sessions already running on it keep going until they end.'
                  )
                : account.onHome
                  ? t(
                      'seal.accounts.remove.login',
                      'Seal forgets this account, deletes the login it saved, and drops it from every rule. Sessions already running on it keep going until they end.'
                    )
                  : t(
                      'seal.accounts.remove.remoteOnly',
                      'This account is not on this computer. Seal removes it from the machines checked below.'
                    )}
          </DialogDescription>
        </DialogHeader>
        {systemLogin ? (
          <div
            className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
            data-slot="seal-remove-system-login"
          >
            <p>
              {t(
                'seal.accounts.remove.systemLogin',
                'This is also the login the `{{value0}}` CLI uses on this computer outside Seal.',
                { value0: cli }
              )}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
              <li>
                {t(
                  'seal.accounts.remove.systemKeep',
                  'Remove from Seal: `{{value0}}` stays signed in in your own terminal. Seal stops listing and using the account until you add it again.',
                  { value0: cli }
                )}
              </li>
              <li>
                {t(
                  'seal.accounts.remove.systemLogout',
                  'Remove and log out: also runs `{{value0}}` and signs this computer out.',
                  {
                    value0: candidate.provider === 'claude' ? 'claude auth logout' : 'codex logout'
                  }
                )}
              </li>
            </ul>
          </div>
        ) : null}
        {others.length > 0 ? (
          <fieldset className="grid gap-2 text-sm">
            <legend className="mb-1 text-xs text-muted-foreground">
              {t('seal.accounts.remove.alsoFrom', 'Also remove its login from')}
            </legend>
            {others.map((machine) => (
              <label key={machine.machineId} className="flex items-center gap-2">
                <Checkbox
                  checked={machineIds.includes(machine.machineId)}
                  onCheckedChange={(checked) =>
                    setMachineIds((current) =>
                      checked
                        ? [...current, machine.machineId]
                        : current.filter((id) => id !== machine.machineId)
                    )
                  }
                />
                <span className="truncate">{machine.machineLabel}</span>
                {machine.sessions > 0 ? (
                  <span className="text-xs text-muted-foreground">
                    {t('seal.accounts.machine.sessionsThere', '{{value0}} running', {
                      value0: machine.sessions
                    })}
                  </span>
                ) : null}
              </label>
            ))}
          </fieldset>
        ) : null}
        {leftBehind.length > 0 ? (
          <p className="text-xs text-muted-foreground" data-slot="seal-remove-left-behind">
            {t(
              'seal.accounts.remove.leftBehind',
              'The login pushed to {{value0}} stays there: that machine has no Seal server to remove it. Sign out there to remove it.',
              { value0: leftBehind.map((machine) => machine.machineLabel).join(', ') }
            )}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('seal.accounts.cancel', 'Cancel')}
          </Button>
          {systemLogin ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void confirm(true)}
              data-slot="seal-remove-logout"
            >
              {t('seal.accounts.remove.confirmLogout', 'Remove and log out')}
            </Button>
          ) : null}
          <Button
            variant="destructive"
            disabled={busy || (!account.onHome && machineIds.length === 0)}
            onClick={() => void confirm(false)}
            data-slot="seal-remove-confirm"
          >
            {systemLogin
              ? t('seal.accounts.remove.confirmSeal', 'Remove from Seal')
              : t('seal.accounts.remove.confirm', 'Remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
