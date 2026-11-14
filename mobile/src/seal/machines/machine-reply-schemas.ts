import * as z from 'zod'
import { parseExecutionHostId } from '../../../../src/shared/execution-host'
import { parseMachineId } from '../../../../src/shared/machines/machine-types'

const nullableNumber = z.number().finite().nullable().catch(null)
const nullableString = z.string().nullable().catch(null)
const machineOs = z.enum(['linux', 'darwin', 'win32']).nullable().catch(null)
const machineId = z.custom<string>((value) => parseMobileMachineId(value) !== null)

/** Older hosts name machines by execution host id; unified hosts use `local` / `machine:<id>`. */
export function parseMobileMachineId(value: unknown): string | null {
  return (
    parseMachineId(value) ??
    (typeof value === 'string' ? (parseExecutionHostId(value)?.id ?? null) : null)
  )
}

/** Unified hosts send `connection` instead of the older `kind`. */
export function withMachineKind(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || 'kind' in value || !('connection' in value)) {
    return value
  }
  const kind = value.connection === 'server' ? 'runtime' : value.connection
  return { ...value, kind }
}

const machineSummaryFields = z.looseObject({
  id: machineId,
  kind: z.enum(['local', 'ssh', 'runtime']),
  label: z.string(),
  address: nullableString,
  status: z.enum(['online', 'connecting', 'offline', 'error']).catch('offline'),
  statusDetail: nullableString,
  os: machineOs
})

export const machineSummarySchema = z.preprocess(withMachineKind, machineSummaryFields)

export type MobileMachineSummary = z.output<typeof machineSummarySchema>

// A machine this phone cannot read drops out of the list instead of hiding every other one.
export const machineListSchema = z.looseObject({
  machines: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = machineSummarySchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
  )
})

export const machineMetricsSchema = z.looseObject({
  hostname: nullableString,
  os: machineOs,
  osRelease: nullableString,
  arch: nullableString,
  cpuCount: nullableNumber,
  cpuModel: nullableString,
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).nullable().catch(null),
  cpuUsagePercent: nullableNumber,
  memTotalBytes: nullableNumber,
  memAvailableBytes: nullableNumber,
  diskTotalBytes: nullableNumber,
  diskAvailableBytes: nullableNumber,
  diskMount: nullableString,
  uptimeSeconds: nullableNumber,
  homeDir: nullableString,
  collectedAt: z.number().catch(0)
})

export type MobileMachineMetrics = z.output<typeof machineMetricsSchema>

export const machineFileEntrySchema = z.looseObject({
  name: z.string().min(1),
  kind: z.enum(['file', 'directory', 'symlink', 'other']).catch('other'),
  isDirectoryLike: z.boolean(),
  size: z.number().nonnegative().catch(0),
  mtimeMs: z.number().catch(0)
})

export type MobileMachineFileEntry = z.output<typeof machineFileEntrySchema>

export const machineDirListingSchema = z.looseObject({
  path: z.string().min(1),
  entries: z.array(machineFileEntrySchema),
  totalEntries: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  listedAt: z.number().catch(0),
  fromCache: z.boolean().catch(false)
})

export type MobileMachineDirListing = z.output<typeof machineDirListingSchema>

export const machineFileReadSchema = z.looseObject({
  path: z.string(),
  size: z.number().int().nonnegative(),
  contentBase64: z.string(),
  truncated: z.boolean()
})

export const machineTransferSchema = z.looseObject({
  id: z.string().min(1),
  machineId: z.string(),
  direction: z.enum(['upload', 'download', 'url-download']).catch('download'),
  label: z.string(),
  destination: z.string(),
  totalBytes: nullableNumber,
  transferredBytes: z.number().nonnegative().catch(0),
  filesTotal: z.number().catch(0),
  filesDone: z.number().catch(0),
  status: z.enum(['running', 'done', 'failed', 'cancelled']),
  error: nullableString,
  startedAt: z.number().catch(0),
  finishedAt: nullableNumber
})

export type MobileMachineTransfer = z.output<typeof machineTransferSchema>

export const machineTransferListSchema = z.looseObject({
  transfers: z.array(z.unknown()).transform((items) =>
    items.flatMap((item) => {
      const parsed = machineTransferSchema.safeParse(item)
      return parsed.success ? [parsed.data] : []
    })
  )
})
