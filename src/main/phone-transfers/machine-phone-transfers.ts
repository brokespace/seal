import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseExecutionHostId } from '../../shared/execution-host'
import type { MachineId, MachineTransfer } from '../../shared/machines/machine-types'
import type { PhoneDownloadTicket } from '../../shared/rpc-contract/phone-transfer-params'
import { sourceBasename } from '../machines/transfers/machine-transfer-plan'
import { getMachineServices, onMachineTransferUpdated } from '../machines/machine-services'
import { commitPhoneUpload, openPhoneDownload } from './phone-transfer-staging'

function whenTransferSettles(transferId: string): Promise<MachineTransfer> {
  return new Promise((resolve) => {
    const check = (transfer: MachineTransfer): void => {
      if (transfer.id === transferId && transfer.status !== 'running') {
        off()
        resolve(transfer)
      }
    }
    const off = onMachineTransferUpdated(check)
    const current = getMachineServices()
      .transfers.list()
      .find((t) => t.id === transferId)
    if (current) {
      check(current)
    }
  })
}

/** Moves a finished phone upload onto the machine through the shared transfer queue. */
export async function uploadStagedToMachine(
  machineId: MachineId,
  uploadId: string,
  destDir: string
): Promise<MachineTransfer> {
  const staged = await commitPhoneUpload(uploadId)
  try {
    const transfer = getMachineServices().transfers.upload(machineId, [staged.path], destDir)
    void whenTransferSettles(transfer.id).finally(() => void staged.release())
    return transfer
  } catch (error) {
    await staged.release()
    throw error
  }
}

/** Remote files are first copied to this host (visible in the Transfers list), then served in chunks. */
export async function openMachineFileForPhone(
  machineId: MachineId,
  path: string
): Promise<PhoneDownloadTicket> {
  if (parseExecutionHostId(machineId)?.kind === 'local') {
    return openPhoneDownload(path)
  }
  const dir = await mkdtemp(join(tmpdir(), 'seal-phone-download-'))
  try {
    const transfer = getMachineServices().transfers.download(machineId, [path], dir)
    const settled = await whenTransferSettles(transfer.id)
    if (settled.status !== 'done') {
      throw new Error(settled.error ?? `Download ${settled.status}`)
    }
    const fileName = sourceBasename(path)
    return await openPhoneDownload(join(dir, fileName), { fileName, ownedDir: dir })
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    throw error
  }
}
