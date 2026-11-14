import { X } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import type { SealAccountsStatus } from '../../../../../shared/seal-accounts/seal-accounts-status'
import type { SealFleetOverview } from '../../../../../shared/seal-accounts/seal-fleet-overview'
import { Button } from '../../ui/button'

type SealAccountsNoticesProps = {
  overview: SealFleetOverview
  status: SealAccountsStatus
  error: string | null
  onDismissNotice: () => void
}

/** What the person should know before reading the list: merges, unreachable machines, stale data. */
export function SealAccountsNotices({
  overview,
  status,
  error,
  onDismissNotice
}: SealAccountsNoticesProps): React.JSX.Element | null {
  const t = useTranslate()
  const notice = status.migrationNotice?.merged.length ? status.migrationNotice : null
  const unreachable = overview.machines.filter(
    (machine) => !machine.home && machine.runsSeal && !machine.reachable
  )
  if (!notice && unreachable.length === 0 && !error && !status.secretStorage.protectionGap) {
    return null
  }
  return (
    <div className="space-y-2" data-slot="seal-accounts-notices">
      {notice ? (
        <div
          className="flex items-start gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
          role="status"
          data-slot="seal-migration-notice"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="font-medium">
              {t('seal.accounts.notice.mergedTitle', 'Seal merged duplicate accounts')}
            </p>
            <p className="text-muted-foreground">
              {t(
                'seal.accounts.notice.mergedBody',
                'Accounts saved more than once now appear once, keeping the copy with the newest login:'
              )}{' '}
              {notice.merged
                .map((entry) =>
                  t('seal.accounts.notice.mergedEntry', '{{value0}} ({{value1}} removed)', {
                    value0: entry.label,
                    value1: entry.removed
                  })
                )
                .join(', ')}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('seal.accounts.notice.dismiss', 'Dismiss')}
            onClick={onDismissNotice}
          >
            <X />
          </Button>
        </div>
      ) : null}
      {unreachable.map((machine) => (
        <p
          key={machine.id}
          className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {t(
            'seal.accounts.notice.unreachable',
            '{{value0}} did not answer, so its logins and sessions are not shown.',
            { value0: machine.label }
          )}
          {machine.error ? ` ${machine.error}` : ''}
        </p>
      ))}
      {status.secretStorage.protectionGap ? (
        <p className="rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs text-status-warning-text">
          {status.secretStorage.protectionGap}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t('seal.accounts.notice.stale', 'Showing the last reading. {{value0}}', {
            value0: error
          })}
        </p>
      ) : null}
    </div>
  )
}
