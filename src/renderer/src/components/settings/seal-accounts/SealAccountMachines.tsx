import { Monitor, Server } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  SealAccountPresence,
  SealFleetAccount
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { sealHealthLabel, sealHealthTone } from './seal-account-presentation'

const DOT_CLASS = {
  ok: 'bg-status-success',
  warning: 'bg-status-warning',
  dead: 'bg-destructive'
} as const

function presenceDetail(presence: SealAccountPresence, t: Translate): string {
  if (!presence.reported) {
    return t(
      'seal.accounts.machine.pushedThere',
      'Login pushed from this computer. This machine has no Seal server, so its state is not shown.'
    )
  }
  return [
    sealHealthLabel(presence.health, t),
    presence.active ? t('seal.accounts.machine.activeThere', 'new sessions start on it') : null,
    presence.systemLogin ? t('seal.accounts.machine.systemThere', 'system login') : null,
    presence.sessions > 0
      ? t('seal.accounts.machine.sessionsThere', '{{value0}} running', {
          value0: presence.sessions
        })
      : null
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The machines that hold this account's login, each with its own health. */
export function SealAccountMachines({ account }: { account: SealFleetAccount }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
      data-slot="seal-account-machines"
    >
      <span>{t('seal.accounts.machine.heldOn', 'Signed in on')}</span>
      {account.machines.map((presence) => {
        const Icon = presence.home ? Monitor : Server
        return (
          <span
            key={presence.machineId}
            title={presenceDetail(presence, t)}
            className="inline-flex h-5 max-w-48 items-center gap-1 rounded-md border border-border px-1.5 text-foreground"
            data-machine-id={presence.machineId}
          >
            <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{presence.machineLabel}</span>
            {presence.reported ? (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  DOT_CLASS[sealHealthTone(presence.health)]
                )}
                aria-hidden
              />
            ) : null}
            <span className="sr-only">{presenceDetail(presence, t)}</span>
          </span>
        )
      })}
      {account.onHome ? null : (
        <span>{t('seal.accounts.machine.notHere', 'Not on this computer')}</span>
      )}
    </div>
  )
}
