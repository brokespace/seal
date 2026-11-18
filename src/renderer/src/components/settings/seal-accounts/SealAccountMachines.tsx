import { FolderGit2, Monitor, Server } from 'lucide-react'
import { useTranslate, type Translate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  SealAccountPresence,
  SealFleetAccount,
  SealFleetTie
} from '../../../../../shared/seal-accounts/seal-fleet-overview'
import {
  SEAL_HEALTH_DOT_CLASS,
  SEAL_HEALTH_TEXT_CLASS,
  sealHealthLabel,
  sealHealthTone
} from './seal-account-presentation'

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

function tieName(tie: SealFleetTie, t: Translate): string {
  return tie.machineLabel
    ? t('seal.accounts.rules.projectOnMachine', '{{value0}} on {{value1}}', {
        value0: tie.name,
        value1: tie.machineLabel
      })
    : tie.name
}

function tieDetail(tie: SealFleetTie, t: Translate): string {
  if (tie.scope === 'machine') {
    return tie.role === 'default'
      ? t('seal.accounts.ties.machineDefault', 'New sessions on this machine start on it')
      : t('seal.accounts.ties.machineAllowed', 'One of the accounts this machine may use')
  }
  return tie.role === 'default'
    ? t('seal.accounts.ties.projectDefault', 'New sessions in this project start on it')
    : t('seal.accounts.ties.projectAllowed', 'One of the accounts this project may use')
}

const CHIP_CLASS =
  'inline-flex h-5 max-w-48 items-center gap-1 rounded-md border border-border px-1.5 text-foreground'

/** The machines that hold this account's login, each with its own health, and the rules that name it. */
export function SealAccountMachines({ account }: { account: SealFleetAccount }): React.JSX.Element {
  const t = useTranslate()
  return (
    <div className="space-y-1.5">
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
              className={CHIP_CLASS}
              data-machine-id={presence.machineId}
            >
              <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{presence.machineLabel}</span>
              {presence.reported ? (
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    SEAL_HEALTH_DOT_CLASS[sealHealthTone(presence.health)]
                  )}
                  aria-hidden
                />
              ) : null}
              {presence.reported && presence.health.state !== 'ok' ? (
                <span
                  className={SEAL_HEALTH_TEXT_CLASS[sealHealthTone(presence.health)]}
                  data-slot="seal-account-machine-health"
                  aria-hidden
                >
                  {sealHealthLabel(presence.health, t)}
                </span>
              ) : null}
              <span className="sr-only">{presenceDetail(presence, t)}</span>
            </span>
          )
        })}
        {account.onHome ? null : (
          <span>{t('seal.accounts.machine.notHere', 'Not on this computer')}</span>
        )}
      </div>
      {account.ties.length > 0 ? (
        <div
          className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
          data-slot="seal-account-ties"
        >
          <span>{t('seal.accounts.ties.usedBy', 'Used by')}</span>
          {account.ties.map((tie) => {
            const Icon = tie.scope === 'machine' ? Server : FolderGit2
            const name = tieName(tie, t)
            return (
              <span
                key={`${tie.scope}:${name}`}
                title={tieDetail(tie, t)}
                className={CHIP_CLASS}
                data-tie-role={tie.role}
              >
                <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{name}</span>
                {tie.role === 'default' ? (
                  <span className="shrink-0 text-muted-foreground">
                    {t('seal.accounts.ties.default', 'default')}
                  </span>
                ) : null}
                <span className="sr-only">{tieDetail(tie, t)}</span>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
