import { defineMethod } from '../../core'
import {
  parseMachineId,
  type MachineFileRead,
  type MachineId
} from '../../../../../shared/machines/machine-types'
import {
  PHONE_MACHINE_PREVIEW_MAX_BYTES,
  SealMachinesDiskIndexParams,
  SealMachinesDownloadUrlParams,
  SealMachinesIdParams,
  SealMachinesListDirParams,
  SealMachinesPathParams,
  SealMachinesReadFileParams,
  SealMachinesRemoveParams,
  SealMachinesRenameParams,
  SealMachinesTransferIdParams,
  SealMachinesUploadStagedParams,
  type SealMachinesListResult
} from '../../../../../shared/rpc-contract/seal-machines-params'
import {
  PhoneDownloadIdParams,
  PhoneDownloadReadParams,
  PhoneUploadAppendParams,
  PhoneUploadBeginParams,
  PhoneUploadIdParams
} from '../../../../../shared/rpc-contract/phone-transfer-params'
import { listMachineSummaries } from '../../../../machines/machine-inventory'
import {
  getMachineServices,
  invalidateMachineParentDir,
  removeMachinePaths,
  resolveMachineConnection,
  resolveMachineFileSystem
} from '../../../../machines/machine-services'
import {
  ensureMachineDiskIndex,
  queryMachineDiskIndex
} from '../../../../machines/resources/machine-disk-index'
import {
  openMachineFileForPhone,
  uploadStagedToMachine
} from '../../../../phone-transfers/machine-phone-transfers'
import {
  abortPhoneUpload,
  appendPhoneUpload,
  beginPhoneUpload,
  endPhoneDownload,
  readPhoneDownload
} from '../../../../phone-transfers/phone-transfer-staging'

function machineId(value: string): MachineId {
  const parsed = parseMachineId(value)
  if (!parsed) {
    throw new Error('Unknown machine')
  }
  return parsed
}

// The phone's Machines tab: the same local/SSH/server machines and file access the desktop tab has.
export const SEAL_MACHINE_METHODS = [
  defineMethod({
    name: 'sealMachines.list',
    permission: 'workspace',
    params: null,
    handler: (): SealMachinesListResult => ({ machines: listMachineSummaries() })
  }),
  defineMethod({
    name: 'sealMachines.metrics',
    permission: 'workspace',
    params: SealMachinesIdParams,
    handler: async (params) => {
      const connection = resolveMachineConnection(machineId(params.machineId))
      const metrics = await connection.metrics()
      ensureMachineDiskIndex(connection)
      return metrics
    }
  }),
  defineMethod({
    name: 'sealMachines.diskIndex',
    permission: 'workspace',
    params: SealMachinesDiskIndexParams,
    handler: async (params) => {
      const connection = resolveMachineConnection(machineId(params.machineId))
      await connection.connect()
      const reply = await queryMachineDiskIndex(connection, params.request)
      if (!reply.ok) {
        throw new Error(reply.message)
      }
      return reply
    }
  }),
  defineMethod({
    name: 'sealMachines.listDir',
    permission: 'workspace',
    params: SealMachinesListDirParams,
    handler: async (params) => {
      const id = machineId(params.machineId)
      const path = params.path ?? (await resolveMachineFileSystem(id).homeDir())
      return getMachineServices().directories.listDir(id, path, {
        force: params.force === true,
        offset: params.offset ?? 0
      })
    }
  }),
  defineMethod({
    name: 'sealMachines.readFile',
    permission: 'workspace',
    params: SealMachinesReadFileParams,
    handler: async (params): Promise<MachineFileRead> => {
      const maxBytes = params.maxBytes ?? PHONE_MACHINE_PREVIEW_MAX_BYTES
      const { size, data } = await resolveMachineFileSystem(machineId(params.machineId)).readFile(
        params.path,
        maxBytes
      )
      return {
        path: params.path,
        size,
        contentBase64: data.toString('base64'),
        truncated: size > data.length
      }
    }
  }),
  defineMethod({
    name: 'sealMachines.createDir',
    permission: 'workspace',
    params: SealMachinesPathParams,
    handler: async (params) => {
      const id = machineId(params.machineId)
      await resolveMachineFileSystem(id).createDir(params.path)
      invalidateMachineParentDir(id, params.path)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'sealMachines.rename',
    permission: 'workspace',
    params: SealMachinesRenameParams,
    handler: async (params) => {
      const id = machineId(params.machineId)
      await resolveMachineFileSystem(id).rename(params.from, params.to)
      invalidateMachineParentDir(id, params.from)
      invalidateMachineParentDir(id, params.to)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'sealMachines.remove',
    permission: 'workspace',
    params: SealMachinesRemoveParams,
    handler: async (params) => {
      await removeMachinePaths(machineId(params.machineId), params.paths)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'sealMachines.uploadStaged',
    permission: 'workspace',
    params: SealMachinesUploadStagedParams,
    handler: (params) =>
      uploadStagedToMachine(machineId(params.machineId), params.uploadId, params.destDir)
  }),
  defineMethod({
    name: 'sealMachines.openDownload',
    permission: 'workspace',
    params: SealMachinesPathParams,
    handler: (params) => openMachineFileForPhone(machineId(params.machineId), params.path)
  }),
  defineMethod({
    name: 'sealMachines.downloadUrl',
    permission: 'workspace',
    params: SealMachinesDownloadUrlParams,
    handler: (params) =>
      getMachineServices().transfers.downloadUrl(
        machineId(params.machineId),
        params.url,
        params.destDir,
        params.fileName
      )
  }),
  defineMethod({
    name: 'sealMachines.listTransfers',
    permission: 'workspace',
    params: null,
    handler: () => ({ transfers: getMachineServices().transfers.list() })
  }),
  defineMethod({
    name: 'sealMachines.cancelTransfer',
    permission: 'workspace',
    params: SealMachinesTransferIdParams,
    handler: (params) => {
      getMachineServices().transfers.cancel(params.transferId)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'phoneTransfer.beginUpload',
    permission: 'workspace',
    params: PhoneUploadBeginParams,
    handler: (params) => beginPhoneUpload(params.fileName, params.size)
  }),
  defineMethod({
    name: 'phoneTransfer.appendUpload',
    permission: 'workspace',
    params: PhoneUploadAppendParams,
    handler: (params) => appendPhoneUpload(params.uploadId, params.offset, params.dataBase64)
  }),
  defineMethod({
    name: 'phoneTransfer.abortUpload',
    permission: 'workspace',
    params: PhoneUploadIdParams,
    handler: async (params) => {
      await abortPhoneUpload(params.uploadId)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'phoneTransfer.read',
    permission: 'workspace',
    params: PhoneDownloadReadParams,
    handler: (params) => readPhoneDownload(params.downloadId, params.offset, params.length)
  }),
  defineMethod({
    name: 'phoneTransfer.endDownload',
    permission: 'workspace',
    params: PhoneDownloadIdParams,
    handler: async (params) => {
      await endPhoneDownload(params.downloadId)
      return { ok: true }
    }
  })
]
