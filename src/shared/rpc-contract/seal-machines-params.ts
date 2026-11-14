import * as z from 'zod'
import type { MachineSummary } from '../machines/machine-summaries'
import { parseMachineId } from '../machines/machine-types'

const MachineIdParam = z
  .string()
  .min(1)
  .refine((value) => parseMachineId(value) !== null, 'Unknown machine')

const MachinePath = z.string().min(1).max(4096)

/** Phones preview at most this much inline; bigger files go through a download ticket. */
export const PHONE_MACHINE_PREVIEW_MAX_BYTES = 4 * 1024 * 1024

export const SealMachinesIdParams = z.object({ machineId: MachineIdParam }).strict()

export const SealMachinesListDirParams = z
  .object({
    machineId: MachineIdParam,
    /** Omitted opens the machine's home directory. */
    path: MachinePath.optional(),
    offset: z.number().int().nonnegative().optional(),
    force: z.boolean().optional()
  })
  .strict()

export const SealMachinesReadFileParams = z
  .object({
    machineId: MachineIdParam,
    path: MachinePath,
    maxBytes: z.number().int().positive().max(PHONE_MACHINE_PREVIEW_MAX_BYTES).optional()
  })
  .strict()

export const SealMachinesPathParams = z
  .object({ machineId: MachineIdParam, path: MachinePath })
  .strict()

export const SealMachinesRenameParams = z
  .object({ machineId: MachineIdParam, from: MachinePath, to: MachinePath })
  .strict()

export const SealMachinesRemoveParams = z
  .object({ machineId: MachineIdParam, paths: z.array(MachinePath).min(1).max(500) })
  .strict()

export const SealMachinesUploadStagedParams = z
  .object({ machineId: MachineIdParam, destDir: MachinePath, uploadId: z.string().min(1) })
  .strict()

export const SealMachinesDownloadUrlParams = z
  .object({
    machineId: MachineIdParam,
    url: z.string().url().max(8192),
    destDir: MachinePath,
    fileName: z.string().trim().min(1).max(255).optional()
  })
  .strict()

export const SealMachinesTransferIdParams = z.object({ transferId: z.string().min(1) }).strict()

export type SealMachinesListResult = { machines: MachineSummary[] }
