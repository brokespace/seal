import React from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { serverInstallFailureText } from './seal-server-install-copy'

/** The last install failed, so the machine is on plain SSH; a blocked move can still go ahead. */
export function MachineServerRetryNotice({
  view,
  busy,
  onRetry,
  onMoveAnyway
}: {
  view: Pick<MachineView, 'name' | 'serverInstall' | 'serverMoveBlocked'>
  busy: boolean
  onRetry: () => void
  onMoveAnyway: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const blocked = view.serverMoveBlocked
  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md border border-status-warning-border bg-status-warning-background px-3 py-2 text-xs"
    >
      <TriangleAlert
        className="mt-1.5 size-3.5 shrink-0 text-status-warning-text"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1 basis-64 space-y-1.5 py-1">
        <p className="[overflow-wrap:anywhere]">
          <span className="text-status-warning-text">{serverInstallFailureText(t, view)}</span>{' '}
          <span className="text-muted-foreground">
            {t('w7.notice.stillSsh', 'This machine still works over SSH.')}
          </span>
        </p>
        {blocked ? (
          <>
            <div className="space-y-0.5">
              <p className="font-medium text-foreground">
                {t('auto.components.settings.moveAnyway.title', 'Move this host anyway')}
              </p>
              <p className="text-muted-foreground">
                {t(
                  'auto.components.settings.moveAnyway.description',
                  'Orca sets itself up on {{host}} without the saved items below. They stay on this computer and don’t appear on {{host}}. Unsaved edits are kept, never deleted.',
                  { host: view.name }
                )}
              </p>
            </div>
            {blocked.detail ? (
              <pre className="scrollbar-sleek max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background px-3 py-2 font-mono text-2xs leading-relaxed text-muted-foreground">
                {blocked.detail}
              </pre>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="outline" size="xs" disabled={busy} onClick={onRetry}>
          {t('w7.notice.retry', 'Retry install')}
        </Button>
        {blocked ? (
          <Button type="button" size="xs" disabled={busy} onClick={onMoveAnyway}>
            {t('auto.components.settings.moveAnyway.confirm', 'Move anyway')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Shown once on an SSH machine added before installs were the default; either choice ends it. */
export function MachineServerOfferNotice({
  busy,
  onInstall,
  onDecline
}: {
  busy: boolean
  onInstall: () => void
  onDecline: () => void
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2 text-xs"
    >
      <p className="min-w-0 flex-1 basis-64">
        {t(
          'w7.notice.offer',
          'Install Seal server on this machine? It keeps agents running when this computer disconnects, and enables chat, sessions and file features here. Nothing changes until you choose.'
        )}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onDecline}>
          {t('w7.notice.notNow', 'Not now')}
        </Button>
        <Button type="button" size="xs" disabled={busy} onClick={onInstall}>
          {t('w7.server.install', 'Install Seal server')}
        </Button>
      </div>
    </div>
  )
}
