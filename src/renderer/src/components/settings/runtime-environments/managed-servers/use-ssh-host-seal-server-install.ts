import { useCallback } from 'react'
import { toast } from 'sonner'
import {
  findSshTargetMachine,
  showSshTargetMachine
} from '@/components/machines/model/ssh-target-machine'
import { serverInstallFailureText } from '@/components/machines/server-install/seal-server-install-copy'
import { SEAL_SERVER_ERROR_TOAST_MS } from '@/components/machines/server-install/seal-server-install-requests'
import { useSealServerInstall } from '@/components/machines/server-install/use-seal-server-install'
import { useTranslate } from '@/i18n/use-translate'
import type { MachineView } from '../../../../../../shared/machines/machine-view'

/**
 * Settings' way to put Seal server on an SSH host: the confirmed install of the machine that holds
 * the host, with the outcome said in a toast because the machine's page is not on screen.
 * Resolves the machine as the install left it, which says `serverInstallAction: 'reuse'` and has
 * nothing installed when its user set up a server there. Resolves null when nothing ran: the user
 * cancelled, the request failed and said why, or the host is not in Machines.
 */
export function useSshHostSealServerInstall(): (
  sshTargetId: string
) => Promise<MachineView | null> {
  const installServer = useSealServerInstall()
  const t = useTranslate()
  return useCallback(
    async (sshTargetId) => {
      const machine = await findSshTargetMachine(sshTargetId)
      if (!machine) {
        await showSshTargetMachine(sshTargetId)
        return null
      }
      // Already known to hold its user's own server: there is no install to ask about.
      const view = machine.serverInstallAction === 'reuse' ? machine : await installServer(machine)
      if (!view || view.serverInstallAction === 'reuse') {
        return view
      }
      if (view.connection === 'server') {
        toast.success(
          t('auto.components.settings.serverList.setUpDone', 'Orca is set up on {{name}}.', {
            name: view.name
          })
        )
      } else {
        toast.error(serverInstallFailureText(t, view), {
          duration: SEAL_SERVER_ERROR_TOAST_MS,
          action: {
            label: t('auto.components.live-sessions.menu.openMachine', 'Open machine'),
            onClick: () => void showSshTargetMachine(sshTargetId)
          }
        })
      }
      return view
    },
    [installServer, t]
  )
}
