import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { MachineView } from '../../../../../../shared/machines/machine-view'
import type { SshTarget } from '../../../../../../shared/ssh-types'
import { useMachineViews } from '@/components/machines/model/use-machines-inventory'
import { machineOfSshTarget } from '@/components/machines/model/ssh-target-machine'
import {
  MachineServerInstallProgress,
  MachineServerReuseNotice
} from '@/components/machines/server-install/MachineServerInstallNotice'
import { serverInstallIsRunning } from '@/components/machines/server-install/seal-server-install-copy'
import {
  hasNoSealServerYet,
  useOwnSealServerReuse
} from '@/components/machines/server-install/use-seal-server-install'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useTranslate } from '@/i18n/use-translate'
import { useAppStore } from '@/store/index'
import { Button } from '../../../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../../ui/dialog'
import { Label } from '../../../ui/label'
import { HostCombobox } from '../../../host-picker/HostCombobox'
import { useSshHostSealServerInstall } from './use-ssh-host-seal-server-install'

type RuntimeInstallServerDialogProps = {
  open: boolean
  emptyTargets: SshTarget[]
  loadFailed: boolean
  onOpenChange: (open: boolean) => void
  onDeployed: () => Promise<void> | void
}

/** Chooses the SSH host; the install itself is the machine's own, behind its confirmation dialog. */
export function RuntimeInstallServerDialog({
  open,
  emptyTargets,
  loadFailed,
  onOpenChange,
  onDeployed
}: RuntimeInstallServerDialogProps): React.JSX.Element {
  const t = useTranslate()
  const mountedRef = useMountedRef()
  const confirmAndReuse = useOwnSealServerReuse()
  const installOnHost = useSshHostSealServerInstall()
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)
  const { views } = useMachineViews()
  const [targetId, setTargetId] = useState('')
  const [busy, setBusy] = useState<'install' | 'reuse' | null>(null)
  // The machine as the last request left it, shown until the machine list has caught up.
  const [answered, setAnswered] = useState<MachineView | null>(null)
  const openRef = useRef(open)
  // Scope completion resets to the opening session so background installs cannot clear reopened forms.
  const sessionRef = useRef(0)
  useEffect(() => {
    openRef.current = open
    if (open) {
      sessionRef.current += 1
    }
  }, [open])
  const hostFieldId = useId()
  // A machine that already connects through a Seal server is not a host without one.
  const hosts = emptyTargets.filter((target) => {
    const holder = machineOfSshTarget(views, target.id)
    return !holder || hasNoSealServerYet(holder)
  })
  const targetLabel = hosts.find((target) => target.id === targetId)?.label ?? ''
  const machine =
    answered?.ssh?.targetId === targetId ? answered : machineOfSshTarget(views, targetId)
  const ownServer = machine?.serverInstallAction === 'reuse' ? machine : null
  const installing = machine ? serverInstallIsRunning(machine, false) : false
  const canSubmit = busy === null && targetLabel !== '' && !ownServer && !installing

  // Runs one request for the chosen host, then refreshes the list the way a finished setup did before.
  const run = async (
    kind: 'install' | 'reuse',
    request: () => Promise<MachineView | null>
  ): Promise<void> => {
    const session = sessionRef.current
    setBusy(kind)
    setAnswered(null)
    try {
      const view = await request()
      if (!view) {
        return
      }
      if (view.connection !== 'server') {
        if (mountedRef.current) {
          setAnswered(view)
        }
      } else if (mountedRef.current && (!openRef.current || session === sessionRef.current)) {
        setTargetId('')
        if (openRef.current) {
          onOpenChange(false)
        }
      }
      await onDeployed()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      if (mountedRef.current) {
        setBusy(null)
      }
    }
  }

  // `run` starts once the user confirmed, so an open or cancelled dialog leaves this form alone.
  const reuse = (owner: MachineView): void => {
    const reused = confirmAndReuse(
      owner,
      () =>
        void run('reuse', async () => {
          const view = await reused
          if (view?.connection === 'server') {
            toast.success(
              t(
                'seal.machineServer.settings.reuseDone',
                'Seal now connects to {{name}} through the Seal server you set up there.',
                { name: view.name }
              )
            )
          }
          return view
        })
    )
  }

  const handleOpenChange = (next: boolean): void => {
    if (!next && installing) {
      toast.message(
        t(
          'auto.components.settings.serverList.settingUpInBackground',
          'Setting up Orca on {{name}} in the background. It appears in the list when it’s ready.',
          { name: targetLabel }
        )
      )
    }
    onOpenChange(next)
  }

  return (
    // Allow closing long SSH installs because the install continues in the background.
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) {
              void run('install', () => installOnHost(targetId))
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t(
                'auto.components.settings.serverList.setUpOnSshHost',
                'Set up Orca on an SSH host'
              )}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {t(
                    'auto.components.settings.managedServers.description',
                    'Orca installs itself on an empty SSH host and keeps itself up to date.'
                  )}{' '}
                  {t(
                    'seal.machineServer.settings.asksFirst',
                    'Seal shows what it writes on the host and asks before it installs anything.'
                  )}
                </p>
                <p>
                  {t(
                    'auto.components.settings.managedServers.reassurance',
                    'Runs on each host, reached over your own SSH connection. Your code and files stay where they are. Only Orca’s list of projects, tabs and terminals moves to the host.'
                  )}
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={hostFieldId}>
              {t('auto.components.settings.managedServers.deploy.host', 'SSH host')}
            </Label>
            <HostCombobox
              id={hostFieldId}
              options={hosts}
              value={targetId}
              onChange={setTargetId}
              disabled={busy !== null}
              placeholder={t(
                'auto.components.settings.serverList.installHostPlaceholder',
                'Choose an SSH host without Orca'
              )}
            />
            <p className="text-xs text-muted-foreground">
              {hosts.length === 0
                ? t(
                    'auto.components.settings.serverList.installNoHosts',
                    'No SSH hosts without an Orca server.'
                  )
                : t(
                    'auto.components.settings.serverList.installHostHelp',
                    'Only hosts without an Orca server.'
                  )}{' '}
              <button
                type="button"
                className="cursor-pointer text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => {
                  onOpenChange(false)
                  openSettingsTarget({ pane: 'ssh', repoId: null })
                }}
              >
                {t('auto.components.settings.serverList.addSshHost', 'Add an SSH host')}
              </button>
            </p>
            {loadFailed ? (
              <p className="text-xs text-destructive">
                {t(
                  'auto.components.settings.managedServers.loadFailed',
                  'Orca couldn’t load SSH hosts and unfinished moves. Reopen Settings to try again.'
                )}
              </p>
            ) : null}
          </div>
          {ownServer ? (
            <MachineServerReuseNotice
              view={ownServer}
              busy={busy === 'reuse'}
              onReuse={() => reuse(ownServer)}
            />
          ) : machine && installing ? (
            <MachineServerInstallProgress view={machine} />
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => handleOpenChange(false)}>
              {installing
                ? t('auto.components.settings.serverList.close', 'Close')
                : t('auto.components.settings.serverList.cancel', 'Cancel')}
            </Button>
            {ownServer ? null : (
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit}
                data-machine-server-action="install"
              >
                {t('seal.machineServer.server.installAction', 'Install Seal server…')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
