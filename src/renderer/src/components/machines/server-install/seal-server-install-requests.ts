import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { readIpcErrorMessage } from '@/runtime/errors/ipc-error'
import type { MachinesApi } from '../../../../../preload/api/machines/machines-bridge'
import type { MachineId } from '../../../../../shared/machines/machine-types'
import type {
  MachineServiceManagerChoice,
  MachineView
} from '../../../../../shared/machines/machine-view'

function machinesApi(): MachinesApi {
  const api = window.api.machines
  if (!api) {
    throw new Error(
      translate('w7.server.desktopOnly', 'Seal server is installed from the Seal desktop app.')
    )
  }
  return api
}

// These errors say what to do on the machine, which takes longer to read than a default toast stays.
const ERROR_TOAST_MS = 15_000

async function toastingFailure<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  } catch (error) {
    toast.error(readIpcErrorMessage(error) ?? String(error), { duration: ERROR_TOAST_MS })
    throw error
  }
}

/**
 * Installs Seal's server on an SSH machine and connects through it. Resolves when the attempt
 * ended: the view says `installed`, or `failed` with the reason while the machine stays on plain
 * SSH. Rejects only when SSH cannot connect, after showing the error toast; callers catch it only
 * to end their busy state.
 */
export function installSealServerOnMachine(
  machineId: MachineId,
  options: { manager?: MachineServiceManagerChoice; moveAnyway?: boolean } = {}
): Promise<MachineView> {
  return toastingFailure(() => machinesApi().installServer({ machineId, ...options }))
}

/** Records "Not now", which ends the one-time offer; rejects after showing the error toast. */
export function declineSealServerInstall(machineId: MachineId): Promise<MachineView> {
  return toastingFailure(() => machinesApi().declineServerInstall({ machineId }))
}

/** Removes the service and the server; the machine returns to plain SSH. The caller shows the error. */
export async function removeSealServerFromMachine(machineId: MachineId): Promise<MachineView> {
  return machinesApi().removeServer({ machineId })
}
