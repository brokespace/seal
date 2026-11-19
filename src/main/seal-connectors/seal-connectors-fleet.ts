import * as z from 'zod'
import {
  planConnectorFleetSync,
  type FleetPlanHost
} from '../../shared/seal-connectors/seal-connectors-fleet-plan'
import {
  RefresherLeaseSchema,
  SealConnectorsConfigSchema,
  SignInSecretSchema,
  type SealConnectorsFleetHost,
  type SealConnectorsFleetStatus,
  type SignInSecret
} from '../../shared/seal-connectors/seal-connectors-types'
import { startReplicationLoop } from '../seal-accounts/newest-wins-replication'
import { replicateMergedConfig, signInsLapsing } from './seal-connectors-fleet-sync-steps'
import type { SealReplicaTarget } from '../seal-accounts/seal-config-replication'
import type { SealFleetTransport } from '../seal-accounts/seal-fleet-sync'
import type { SealConnectorsService } from './seal-connectors-service'

const PASS_INTERVAL_MS = 30_000
const LOCAL_TARGET = 'local'

const VersionsReplySchema = z.object({
  hostKey: z.string().nullable(),
  now: z.number(),
  versions: z.record(z.string(), z.number()),
  lease: RefresherLeaseSchema,
  heartbeatAt: z.number(),
  // Hosts from before this field could always hold sign-ins.
  canHoldSignIns: z.boolean().default(true)
})

const HostStatusSchema = z.object({
  hostKey: z.string().nullable(),
  config: SealConnectorsConfigSchema,
  signIns: z.array(
    z.object({
      id: z.string(),
      present: z.boolean(),
      updatedAt: z.number().nullable(),
      expiresAt: z.number().nullable(),
      needsReconnect: z.boolean()
    })
  ),
  lease: RefresherLeaseSchema,
  refreshing: z.boolean(),
  relayPort: z.number().nullable(),
  plugins: z.array(
    z.object({
      id: z.string(),
      installed: z.boolean(),
      path: z.string().nullable(),
      error: z.string().nullable()
    })
  )
})

const SignInsReplySchema = z.array(SignInSecretSchema)

export type SealConnectorsFleetDeps = {
  service: SealConnectorsService
  targets: () => SealReplicaTarget[]
  call: SealFleetTransport
  onHostOnline: (listener: () => void) => () => void
  /** The machine's name for the refresher card and "Connectors here". */
  label: (target: string) => string
  now?: () => number
}

export type SealConnectorsFleet = {
  stop: () => void
  requestPass: () => void
  fleetStatus: () => Promise<SealConnectorsFleetStatus>
}

function errorMessage(error: unknown): string {
  // Replies and errors here never carry sign-in values, so the text is safe to show.
  return error instanceof Error ? error.message : 'Unreachable'
}

/** One connector host as the hub reaches it: this desktop's own runtime or a Seal server. */
type HostClient = {
  target: string
  versions(): Promise<z.infer<typeof VersionsReplySchema>>
  exportSignIns(ids: string[]): Promise<SignInSecret[]>
  importSignIns(signIns: SignInSecret[]): Promise<void>
  setLease(lease: z.infer<typeof RefresherLeaseSchema>): Promise<void>
}

function localClient(service: SealConnectorsService): HostClient {
  return {
    target: LOCAL_TARGET,
    versions: async () => service.signInVersions(),
    exportSignIns: async (ids) => service.exportSignIns(ids),
    importSignIns: async (signIns) => {
      service.importSignIns(signIns)
    },
    setLease: async (lease) => {
      service.setLease(lease)
    }
  }
}

function remoteClient(target: string, call: SealFleetTransport): HostClient {
  return {
    target,
    versions: async () =>
      VersionsReplySchema.parse(await call(target, 'seal.connectors.signInVersions', {})),
    exportSignIns: async (ids) =>
      SignInsReplySchema.parse(await call(target, 'seal.connectors.exportSignIns', { ids })),
    importSignIns: async (signIns) => {
      await call(target, 'seal.connectors.importSignIns', { signIns })
    },
    setLease: async (lease) => {
      await call(target, 'seal.connectors.setLease', { lease })
    }
  }
}

/** One pass of sign-in and lease sync; returns what could not be reached, by host. */
async function syncSignInsAndLease(
  deps: SealConnectorsFleetDeps,
  clients: Map<string, HostClient>,
  errors: Map<string, string>
): Promise<void> {
  const { service } = deps
  const now = (deps.now ?? Date.now)()
  const local = clients.get(LOCAL_TARGET)
  if (!local) {
    return
  }
  const wanted = new Set(
    service.config().connectors.flatMap((connector) => connector.signIns.map((ref) => ref.id))
  )
  const ofWanted = (versions: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(versions).filter(([id]) => wanted.has(id)))
  const hubReply = await local.versions()
  const hosts: FleetPlanHost[] = await Promise.all(
    [...clients.values()]
      .filter((client) => client.target !== LOCAL_TARGET)
      .map(async (client): Promise<FleetPlanHost> => {
        try {
          const reply = await client.versions()
          if (!reply.hostKey) {
            throw new Error('Not ready yet')
          }
          return {
            target: client.target,
            hostKey: reply.hostKey,
            versions: ofWanted(reply.versions),
            lease: reply.lease,
            // Aged on the host's own clock, so a skewed clock cannot fake a dead owner.
            heartbeatAt: reply.heartbeatAt === 0 ? 0 : now - (reply.now - reply.heartbeatAt),
            answered: true,
            canHoldSignIns: reply.canHoldSignIns
          }
        } catch (error) {
          errors.set(client.target, errorMessage(error))
          return {
            target: client.target,
            hostKey: '',
            versions: {},
            lease: hubReply.lease,
            heartbeatAt: 0,
            answered: false
          }
        }
      })
  )
  const plan = planConnectorFleetSync({
    now,
    designatedHostKey: service.config().refresher.designatedHostKey,
    hub: {
      target: LOCAL_TARGET,
      hostKey: hubReply.hostKey,
      versions: ofWanted(hubReply.versions),
      lease: hubReply.lease,
      heartbeatAt: hubReply.heartbeatAt,
      canHoldSignIns: hubReply.canHoldSignIns
    },
    hosts,
    urgent: signInsLapsing(service, now)
  })
  const carried = new Map<string, SignInSecret>()
  for (const pull of plan.pulls) {
    try {
      for (const secret of (await clients.get(pull.target)?.exportSignIns(pull.ids)) ?? []) {
        carried.set(secret.id, secret)
      }
    } catch (error) {
      errors.set(pull.target, errorMessage(error))
    }
  }
  if (carried.size > 0) {
    try {
      service.importSignIns([...carried.values()])
    } catch (error) {
      errors.set(LOCAL_TARGET, errorMessage(error))
    }
  }
  await Promise.all(
    plan.pushes.map(async (push) => {
      const secrets = push.ids.flatMap((id) => {
        const secret = carried.get(id) ?? service.signIn(id)
        return secret ? [secret] : []
      })
      try {
        await clients.get(push.target)?.importSignIns(secrets)
      } catch (error) {
        errors.set(push.target, errorMessage(error))
      }
    })
  )
  // In order, never in parallel: a host losing the lease stops before the next one starts.
  for (const target of plan.leaseTargets) {
    try {
      await clients.get(target)?.setLease(plan.lease)
    } catch (error) {
      errors.set(target, errorMessage(error))
    }
  }
}

export function startSealConnectorsFleet(deps: SealConnectorsFleetDeps): SealConnectorsFleet {
  const { service, call } = deps
  const run = async (): Promise<void> => {
    await service.ready()
    const targets = deps.targets()
    await replicateMergedConfig(service, targets, call)
    const clients = new Map<string, HostClient>([
      [LOCAL_TARGET, localClient(service)],
      ...targets.map((entry): [string, HostClient] => [
        entry.target,
        remoteClient(entry.target, call)
      ])
    ])
    const errors = new Map<string, string>()
    await syncSignInsAndLease(deps, clients, errors)
    for (const [target, message] of errors) {
      console.warn(`[seal-connectors] Sync with ${deps.label(target)} failed: ${message}`)
    }
  }
  const loop = startReplicationLoop({
    run,
    onEdit: (listener) => service.onLocalEdit(listener),
    onHostOnline: deps.onHostOnline,
    intervalMs: PASS_INTERVAL_MS,
    failureMessage: '[seal-connectors] Could not sync connectors with other machines:'
  })
  const fleetStatus = async (): Promise<SealConnectorsFleetStatus> => {
    const hosts: SealConnectorsFleetHost[] = [
      {
        target: LOCAL_TARGET,
        label: deps.label(LOCAL_TARGET),
        online: true,
        status: service.status(),
        error: null
      }
    ]
    const remote = await Promise.all(
      deps.targets().map(async (entry): Promise<SealConnectorsFleetHost> => {
        const base = { target: entry.target, label: deps.label(entry.target) }
        try {
          const status = HostStatusSchema.parse(
            await call(entry.target, 'seal.connectors.status', {})
          )
          return { ...base, online: true, status, error: null }
        } catch (error) {
          return { ...base, online: false, status: null, error: errorMessage(error) }
        }
      })
    )
    return { hosts: [...hosts, ...remote] }
  }
  return { stop: loop.stop, requestPass: loop.requestPass, fleetStatus }
}

let running: SealConnectorsFleet | null = null

export function installSealConnectorsFleet(deps: SealConnectorsFleetDeps): SealConnectorsFleet {
  running?.stop()
  running = startSealConnectorsFleet(deps)
  return running
}

export function getSealConnectorsFleet(): SealConnectorsFleet | null {
  return running
}
