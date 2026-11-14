import * as z from 'zod'
import { salvagingArray } from '../../../../src/shared/zod-salvage'
import { defineHostQuery } from '../../query/host-query'
import type { HostQueryTarget } from '../../query/host-query-key'
import { defineRpcOperation, runRpcOperation } from '../../transport/rpc/rpc-operation'
import { rpcResultVariant } from '../../transport/rpc/rpc-operation-result-reader'
import { withMachineKind } from '../machines/machine-reply-schemas'

const machineSummarySchema = z.preprocess(
  withMachineKind,
  z.looseObject({
    id: z.string().min(1),
    kind: z.enum(['local', 'ssh', 'runtime']),
    label: z.string(),
    status: z.enum(['online', 'connecting', 'offline', 'error']),
    statusDetail: z.string().nullable()
  })
)

const machineMetricsSchema = z.looseObject({
  loadAverage: z.tuple([z.number(), z.number(), z.number()]).nullable(),
  cpuCount: z.number().nullable(),
  cpuUsagePercent: z.number().nullable(),
  memTotalBytes: z.number().nullable(),
  memAvailableBytes: z.number().nullable(),
  diskTotalBytes: z.number().nullable(),
  diskAvailableBytes: z.number().nullable(),
  collectedAt: z.number()
})

export type SealMachineSummary = z.output<typeof machineSummarySchema>
export type SealMachineMetricsRead = z.output<typeof machineMetricsSchema>

const listMachines = defineRpcOperation({
  name: 'seal-overview.machines',
  method: 'sealMachines.list',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant(
    'machines',
    z.looseObject({ machines: salvagingArray(machineSummarySchema) })
  )
})

const readMetrics = defineRpcOperation({
  name: 'seal-overview.machine-metrics',
  method: 'sealMachines.metrics',
  acceptance: 'require-result-or-throw-message',
  barrier: 'on-settle',
  read: rpcResultVariant('metrics', machineMetricsSchema)
})

export const SEAL_OVERVIEW_TARGET: HostQueryTarget = { exec: 'local' }
export const SEAL_OVERVIEW_NO_INPUT = {}

export const sealOverviewMachinesQuery = defineHostQuery<
  typeof SEAL_OVERVIEW_NO_INPUT,
  SealMachineSummary[]
>({
  family: 'seal.overview.machines',
  fetch: async (client) => (await runRpcOperation(client, listMachines, null)).machines,
  staleTime: 15_000
})

/** One machine's metrics; slow over SSH, so each row reads its own after the list shows. */
export const sealOverviewMetricsQuery = defineHostQuery<
  { machineId: string },
  SealMachineMetricsRead
>({
  family: 'seal.overview.machine-metrics',
  fetch: (client, _target, input) =>
    runRpcOperation(client, readMetrics, { machineId: input.machineId }),
  staleTime: 30_000,
  retry: false
})
