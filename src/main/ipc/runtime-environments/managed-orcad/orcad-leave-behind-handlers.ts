/** IPC for "Move anyway": the user confirms that saved state a move can't carry stays on this desktop. */
import { ipcMain } from 'electron'
import { allowManagedServerMoveLeavingBehind } from '../../../ssh/targets/ssh-target-registry'
import { requiredString } from './orcad-runtime-lifecycle-handlers'

export function registerOrcadLeaveBehindHandlers(): void {
  ipcMain.handle(
    'runtimeEnvironments:allowOrcadMoveLeavingBehind',
    (_event, args: { sshTargetId: string }): void => {
      const sshTargetId = requiredString(args?.sshTargetId, 'SSH target')
      if (!allowManagedServerMoveLeavingBehind(sshTargetId)) {
        throw new Error('The SSH host is gone.')
      }
    }
  )
}
