import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type { MachinesApi } from '../../../../../preload/api/machines/machines-bridge'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type { MachineView } from '../../../../../shared/machines/machine-view'

// These errors say what to do on the machine, which takes longer to read than a default toast stays.
const ERROR_TOAST_MS = 15_000

/**
 * Sends one Seal server request for a machine. Resolves null after showing the error toast, so
 * callers only end their busy state.
 */
export async function sealServerRequest(
  request: (api: MachinesApi) => Promise<MachineView>
): Promise<MachineView | null> {
  try {
    const api = window.api.machines
    if (!api) {
      throw new Error(
        translate(
          'seal.machineServer.server.desktopOnly',
          'Seal server is installed from the Seal desktop app.'
        )
      )
    }
    return await request(api)
  } catch (error) {
    toast.error(readIpcErrorMessage(error) ?? String(error), { duration: ERROR_TOAST_MS })
    return null
  }
}

/** Records "Not now", which ends the one-time offer. */
export function declineSealServerInstall(machineId: MachineId): Promise<MachineView | null> {
  return sealServerRequest((api) => api.declineServerInstall({ machineId }))
}
