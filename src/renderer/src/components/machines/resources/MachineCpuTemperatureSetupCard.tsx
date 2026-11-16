import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { PageCard } from '@/components/page-layout/PageCard'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { useTranslate } from '@/i18n/use-translate'
import { cn } from '@/lib/class-names'
import type {
  MachineCpuTemperatureSetup,
  MachineCpuTemperatureSetupAction,
  MachineCpuTemperatureSetupState
} from '../../../../../shared/machines/machine-cpu-temperature-types'
import type { MachineSummary } from '../../../../../shared/machines/machine-summaries'
import { refreshMachineMetrics } from '../model/machine-metrics-store'
import { machineResourceApi, resourceErrorText } from './machine-resource-requests'

const STATE_DOT: Record<MachineCpuTemperatureSetupState, string> = {
  'not-set-up': 'bg-muted-foreground/50',
  running: 'bg-status-success',
  stopped: 'bg-status-warning',
  failed: 'bg-destructive'
}

type SetupCopy = {
  stateLabel: (state: MachineCpuTemperatureSetupState) => string
  /** Why this connection cannot ask Windows for administrator rights; null when it can. */
  blocker: (setup: MachineCpuTemperatureSetup) => string | null
  /** What Windows will do once the action is confirmed. */
  approval: (setup: MachineCpuTemperatureSetup) => string
}

function useSetupCopy(machine: MachineSummary): SetupCopy {
  const t = useTranslate()
  const names = { machine: machine.label }
  return {
    stateLabel: (state) => {
      switch (state) {
        case 'not-set-up':
          return t('auto.components.machines.cpu.setup.stateNotSetUp', 'Not set up')
        case 'running':
          return t('auto.components.machines.cpu.setup.stateRunning', 'Running')
        case 'stopped':
          return t('auto.components.machines.cpu.setup.stateStopped', 'Not running')
        case 'failed':
          return t('auto.components.machines.cpu.setup.stateFailed', 'Failed')
      }
    },
    blocker: (setup) => {
      switch (setup.elevation) {
        case 'needs-admin':
          return machine.connection === 'local'
            ? t(
                'auto.components.machines.cpu.setup.needsAdminLocal',
                '{{account}} is not an administrator on this PC. Sign in to Windows with an administrator account and set it up from Seal there.',
                { account: setup.account }
              )
            : t(
                'auto.components.machines.cpu.setup.needsAdmin',
                '{{account}} is not an administrator on {{machine}}, so this cannot be done over this connection. Connect with an administrator account.',
                { ...names, account: setup.account }
              )
        case 'no-desktop':
          return t(
            'auto.components.machines.cpu.setup.noDesktop',
            'This connection has no desktop to show the Windows approval prompt on. Open Seal on {{machine}} and do it there, or connect over SSH as an administrator.',
            names
          )
        case 'prompt':
        case 'elevated':
          return null
      }
    },
    approval: (setup) => {
      if (setup.elevation === 'elevated') {
        return t(
          'auto.components.machines.cpu.setup.approvalElevated',
          'This connection already has administrator rights on {{machine}}, so Windows will not ask again: confirming here goes ahead.',
          names
        )
      }
      return machine.connection === 'local'
        ? t(
            'auto.components.machines.cpu.setup.approvalLocal',
            'Windows will ask once to let Windows PowerShell make changes to this PC. Nothing changes unless you choose Yes. If no prompt appears, look for a flashing shield on the taskbar.'
          )
        : t(
            'auto.components.machines.cpu.setup.approvalRemote',
            'Windows will ask once, on {{machine}}’s own screen, to let Windows PowerShell make changes. Nothing changes unless someone chooses Yes there.',
            names
          )
    }
  }
}

function SetupConfirmDialog({
  machine,
  setup,
  action,
  onClose,
  onConfirm
}: {
  machine: MachineSummary
  setup: MachineCpuTemperatureSetup
  action: MachineCpuTemperatureSetupAction | null
  onClose: () => void
  onConfirm: (action: MachineCpuTemperatureSetupAction) => void
}): React.JSX.Element {
  const t = useTranslate()
  const copy = useSetupCopy(machine)
  const names = { machine: machine.label, account: setup.account }
  const install = action !== 'remove'
  const steps = install
    ? [
        t(
          'auto.components.machines.cpu.setup.stepDownload',
          'Downloads LibreHardwareMonitor and the PawnIO driver from their GitHub releases and checks both against checksums built into Seal.'
        ),
        t(
          'auto.components.machines.cpu.setup.stepInstall',
          'Installs them into C:\\Program Files\\Seal CPU Temperature.'
        ),
        t(
          'auto.components.machines.cpu.setup.stepTask',
          'Adds a scheduled task that starts the monitor, with administrator rights, whenever {{account}} signs in to Windows.',
          names
        ),
        t(
          'auto.components.machines.cpu.setup.stepPort',
          'The monitor serves its readings on port 18085 of that machine only: a firewall rule keeps other computers out.'
        )
      ]
    : [
        t(
          'auto.components.machines.cpu.setup.stepRemove',
          'Stops the monitor and removes its scheduled task, firewall rule and folder.'
        ),
        t(
          'auto.components.machines.cpu.setup.stepDriverStays',
          'The PawnIO driver stays, as other hardware tools may use it. Uninstall it from Windows’ installed apps if nothing else needs it.'
        )
      ]
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-machine-cpu-temperature-setup-dialog={action}>
        <DialogHeader>
          <DialogTitle>
            {install
              ? t(
                  'auto.components.machines.cpu.setup.installTitle',
                  'Set up CPU temperature on {{machine}}?',
                  names
                )
              : t(
                  'auto.components.machines.cpu.setup.removeTitle',
                  'Remove the CPU temperature monitor from {{machine}}?',
                  names
                )}
          </DialogTitle>
          <DialogDescription>
            {install
              ? t(
                  'auto.components.machines.cpu.setup.installDescription',
                  'Windows gives a processor’s temperature only to a kernel driver, so this installs a monitor that runs with administrator rights.'
                )
              : t(
                  'auto.components.machines.cpu.setup.removeDescription',
                  'The CPU temperature of {{machine}} will no longer be shown.',
                  names
                )}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
        <p className="text-xs">{copy.approval(setup)}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t('auto.components.machines.cpu.setup.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            variant={install ? 'default' : 'destructive'}
            onClick={() => action && onConfirm(action)}
          >
            {install
              ? t('auto.components.machines.cpu.setup.installConfirm', 'Set up')
              : t('auto.components.machines.cpu.setup.removeConfirm', 'Remove')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The opt-in that gives a Windows machine a CPU temperature. Nothing is installed, and Windows is
 * never asked for administrator rights, until the user confirms it here.
 */
export function MachineCpuTemperatureSetupCard({
  machine,
  hasReading
}: {
  machine: MachineSummary
  hasReading: boolean
}): React.JSX.Element | null {
  const t = useTranslate()
  const copy = useSetupCopy(machine)
  const [setup, setSetup] = useState<MachineCpuTemperatureSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<MachineCpuTemperatureSetupAction | null>(null)
  const [confirming, setConfirming] = useState<MachineCpuTemperatureSetupAction | null>(null)
  const machineId = machine.id

  useEffect(() => {
    let cancelled = false
    setSetup(null)
    setError(null)
    setNotice(null)
    machineResourceApi()
      .cpuTemperatureSetup({ machineId })
      .then((next) => {
        if (!cancelled) {
          setSetup(next)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(resourceErrorText(err))
        }
      })
    return () => {
      cancelled = true
    }
  }, [machineId])

  const run = async (action: MachineCpuTemperatureSetupAction): Promise<void> => {
    setConfirming(null)
    setBusy(action)
    setError(null)
    setNotice(null)
    try {
      const result = await machineResourceApi().runCpuTemperatureSetup({ machineId, action })
      setSetup(result.setup)
      if (result.outcome === 'declined') {
        setNotice(
          t(
            'auto.components.machines.cpu.setup.declined',
            'The Windows prompt was declined, so nothing was changed.'
          )
        )
      } else if (result.outcome === 'failed') {
        setError(
          result.detail ??
            t('auto.components.machines.cpu.setup.notRun', 'Windows did not run the setup.')
        )
      }
      void refreshMachineMetrics(machineId)
    } catch (err) {
      setError(resourceErrorText(err))
    }
    setBusy(null)
  }

  // Another monitor already gives this machine a reading, so there is nothing to offer.
  if (hasReading && (setup === null || setup.state === 'not-set-up')) {
    return null
  }
  const names = { machine: machine.label, account: setup?.account ?? '' }
  // Starting a stopped monitor needs no administrator rights; installing and removing do.
  const blocker = setup ? copy.blocker(setup) : null
  const installBlocked = blocker !== null && setup?.state !== 'stopped'
  const description = !setup
    ? null
    : setup.state === 'not-set-up'
      ? t(
          'auto.components.machines.cpu.setup.notSetUp',
          'Windows gives a processor’s temperature only to a kernel driver. Seal can install LibreHardwareMonitor on {{machine}} to read it, which takes administrator approval once.',
          names
        )
      : setup.state === 'running'
        ? hasReading
          ? t(
              'auto.components.machines.cpu.setup.running',
              'LibreHardwareMonitor is running, and starts whenever {{account}} signs in to Windows.',
              names
            )
          : t(
              'auto.components.machines.cpu.setup.runningNoReading',
              'LibreHardwareMonitor is running but reports no CPU temperature yet. If that does not change within a minute, restart Windows on {{machine}}.',
              names
            )
        : setup.state === 'stopped'
          ? t(
              'auto.components.machines.cpu.setup.stopped',
              'LibreHardwareMonitor is installed but not running. It starts whenever {{account}} signs in to Windows on {{machine}}.',
              names
            )
          : t('auto.components.machines.cpu.setup.failed', 'Setup did not finish.')

  return (
    <PageCard
      title={t('auto.components.machines.cpu.setup.title', 'CPU temperature monitor')}
      action={
        setup ? (
          <span className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
            <span className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[setup.state])} />
            <span className="truncate">{copy.stateLabel(setup.state)}</span>
          </span>
        ) : null
      }
    >
      <div
        className="space-y-2 p-3 text-xs"
        data-machine-cpu-temperature-setup={setup?.state ?? (error ? 'unknown' : 'loading')}
      >
        {setup === null && !error ? (
          <div className="flex h-8 items-center justify-center">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : null}
        {description ? <p className="text-muted-foreground">{description}</p> : null}
        {setup?.message ? (
          <p
            className={cn(
              '[overflow-wrap:anywhere]',
              setup.state === 'failed' ? 'text-destructive' : 'text-status-warning-text'
            )}
            role={setup.state === 'failed' ? 'alert' : undefined}
          >
            {setup.message}
          </p>
        ) : null}
        {blocker ? <p className="text-muted-foreground">{blocker}</p> : null}
        {notice ? <p className="text-muted-foreground">{notice}</p> : null}
        {error ? (
          <p className="text-destructive [overflow-wrap:anywhere]" role="alert">
            {error}
          </p>
        ) : null}
        {busy ? (
          <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
            <Loader2 className="size-3 shrink-0 animate-spin" />
            {busy === 'remove'
              ? t(
                  'auto.components.machines.cpu.setup.removing',
                  'Waiting for Windows approval, then removing the monitor.'
                )
              : setup?.state === 'stopped'
                ? t('auto.components.machines.cpu.setup.starting', 'Starting the monitor.')
                : t(
                    'auto.components.machines.cpu.setup.installing',
                    'Waiting for Windows approval, then downloading and installing. This can take a minute.'
                  )}
          </p>
        ) : null}
        {setup ? (
          <div className="flex flex-wrap gap-2 pt-1">
            {setup.state === 'running' ? null : (
              <Button
                type="button"
                size="xs"
                disabled={busy !== null || installBlocked}
                onClick={() =>
                  setup.state === 'stopped' ? void run('install') : setConfirming('install')
                }
                data-machine-cpu-temperature-setup-action="install"
              >
                {setup.state === 'stopped'
                  ? t('auto.components.machines.cpu.setup.start', 'Start now')
                  : setup.state === 'failed'
                    ? t('auto.components.machines.cpu.setup.retry', 'Set up again')
                    : t('auto.components.machines.cpu.setup.install', 'Set up CPU temperature')}
              </Button>
            )}
            {setup.state === 'not-set-up' ? null : (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={busy !== null || blocker !== null}
                onClick={() => setConfirming('remove')}
                data-machine-cpu-temperature-setup-action="remove"
              >
                {t('auto.components.machines.cpu.setup.remove', 'Remove')}
              </Button>
            )}
          </div>
        ) : null}
      </div>
      {setup ? (
        <SetupConfirmDialog
          machine={machine}
          setup={setup}
          action={confirming}
          onClose={() => setConfirming(null)}
          onConfirm={(action) => void run(action)}
        />
      ) : null}
    </PageCard>
  )
}
