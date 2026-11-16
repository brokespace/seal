import React from 'react'
import { TriangleAlert } from 'lucide-react'
import { LoadingSpinner } from '@/components/LoadingSpinner'
import { Button } from '@/components/ui/button'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type { MachineView } from '../../../../../shared/machines/machine-view'
import { serverInstallFailureText, serverInstallProgressText } from './seal-server-install-copy'

/** The line shown while an install runs, on the machine's page and in Settings. */
export function MachineServerInstallProgress({
  view
}: {
  view: Pick<MachineView, 'serverInstallWaitsForHost'>
}): React.JSX.Element {
  const t = useTranslate()
  return (
    <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <LoadingSpinner className="size-3.5 shrink-0" />
      {serverInstallProgressText(t, view)}
    </p>
  )
}

/** A question about this machine's server: its text, then the buttons that answer it. */
function MachineServerQuestionNotice({
  text,
  breaksLongNames = false,
  children
}: {
  text: string
  /** The text carries names the user chose, which can be longer than the line. */
  breaksLongNames?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border px-3 py-2 text-xs"
    >
      <p className={cn('min-w-0 flex-1 basis-64', breaksLongNames && '[overflow-wrap:anywhere]')}>
        {text}
      </p>
      <div className="ml-auto flex shrink-0 items-center gap-1">{children}</div>
    </div>
  )
}

/** The last install failed or waits, so the machine is on plain SSH; a blocked move can still go ahead. */
export function MachineServerRetryNotice({
  view,
  busy,
  onRetry,
  onMoveAnyway,
  onCallOff
}: {
  view: Pick<MachineView, 'name' | 'serverInstall' | 'serverMoveBlocked'>
  busy: boolean
  onRetry: () => void
  onMoveAnyway: () => void
  /** Ends an install that a later connect would otherwise finish. */
  onCallOff: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const blocked = view.serverMoveBlocked
  const waits = view.serverInstall?.state === 'pending'
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
            {t('seal.machineServer.notice.stillSsh', 'This machine still works over SSH.')}
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
        {waits ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={onCallOff}
            data-machine-server-action="call-off"
          >
            {t('seal.machineServer.notice.callOff', 'Don’t install')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={busy}
          onClick={onRetry}
          data-machine-server-action="retry"
        >
          {t('seal.machineServer.notice.retry', 'Retry install…')}
        </Button>
        {blocked ? (
          <Button
            type="button"
            size="xs"
            disabled={busy}
            onClick={onMoveAnyway}
            data-machine-server-action="move-anyway"
          >
            {t('seal.machineServer.notice.moveAnyway', 'Move anyway…')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Shown once on an SSH machine that never decided; either choice ends it. */
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
    <MachineServerQuestionNotice
      text={t(
        'seal.machineServer.notice.offer',
        'Install Seal server on this machine? It keeps agents running when this computer disconnects, and enables chat, sessions and file features here. Nothing is installed until you confirm.'
      )}
    >
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={busy}
        onClick={onDecline}
        data-machine-server-action="decline"
      >
        {t('seal.machineServer.notice.notNow', 'Not now')}
      </Button>
      <Button
        type="button"
        size="xs"
        disabled={busy}
        onClick={onInstall}
        data-machine-server-action="install"
      >
        {t('seal.machineServer.server.installAction', 'Install Seal server…')}
      </Button>
    </MachineServerQuestionNotice>
  )
}

/** The machine's user set up `seal serve` as a service there, running or stopped: Seal offers that server, not a second one. */
export function MachineServerReuseNotice({
  view,
  busy,
  onReuse
}: {
  view: Pick<MachineView, 'name' | 'serverOwnServe'>
  /** The request is running; the button says so. */
  busy: boolean
  onReuse: () => void
}): React.JSX.Element {
  const t = useTranslate()
  const service = view.serverOwnServe?.name
  return (
    <MachineServerQuestionNotice
      breaksLongNames
      text={
        service
          ? t(
              'seal.machineServer.notice.reuseNamed',
              '{{name}} already has a Seal server that you set up as a service ({{service}}). Seal can use it instead of installing a second one.',
              { name: view.name, service }
            )
          : t(
              'seal.machineServer.notice.reuse',
              '{{name}} already has a Seal server that you set up as a service. Seal can use it instead of installing a second one.',
              { name: view.name }
            )
      }
    >
      <Button
        type="button"
        size="xs"
        disabled={busy}
        onClick={onReuse}
        data-machine-server-action="reuse"
      >
        {busy ? <LoadingSpinner /> : null}
        {t('seal.machineServer.notice.reuseAction', 'Use this server…')}
      </Button>
    </MachineServerQuestionNotice>
  )
}
