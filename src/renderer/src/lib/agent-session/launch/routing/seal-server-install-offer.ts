import { useAppStore } from '@/store/index'

/**
 * Starts the Seal server install for the SSH machine behind an execution host, where chats run
 * through that server. False when the host is not an SSH machine.
 */
export function offerSealServerInstall(executionHostId: string | undefined): boolean {
  if (!executionHostId?.startsWith('ssh:')) {
    return false
  }
  useAppStore.getState().openMachinesPage()
  return true
}
