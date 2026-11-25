import * as z from 'zod'
import { MobileRelayEndpointSchema } from '../../../../src/shared/remote-runtime/relay/mobile-relay-credential-contract'

// A desktop drops a push registration it has not seen renewed for 7 days; past that the request is moot.
const RETENTION_MS = 7 * 24 * 60 * 60_000
const MAX_ENTRIES = 16

const RemovedHostSchema = z.object({
  hostId: z.string().min(1),
  endpoint: z.string().min(1),
  publicKeyB64: z.string().min(1),
  relay: MobileRelayEndpointSchema.optional(),
  expiresAt: z.number().finite()
})
const RemovedHostSecretsSchema = z.object({
  deviceToken: z.string().min(1),
  resumeToken: z.string().min(1).optional()
})

export type RemovedHostRoute = Omit<z.infer<typeof RemovedHostSchema>, 'expiresAt'>
export type RemovedHostSecrets = z.infer<typeof RemovedHostSecretsSchema>

type Dependencies = {
  /** The queue without its credentials, which stay in the secret store. */
  readQueue: () => Promise<string | null>
  writeQueue: (value: string) => Promise<void>
  readSecrets: (hostId: string) => Promise<string | null>
  writeSecrets: (hostId: string, value: string) => Promise<void>
  deleteSecrets: (hostId: string) => Promise<void>
  /** True once the desktop answered the unregister. */
  deliver: (host: RemovedHostRoute, secrets: RemovedHostSecrets) => Promise<boolean>
  isPairedAgain: (host: RemovedHostRoute) => Promise<boolean>
  now: () => number
}

/** Unregister requests for removed desktops that were unreachable, kept until one answers. */
export function createRemovedHostPushUnregisterOutbox(dependencies: Dependencies) {
  let work: Promise<void> = Promise.resolve()

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const pending = work.then(operation)
    work = pending.then(
      () => {},
      () => {}
    )
    return pending
  }

  async function readEntries(): Promise<z.infer<typeof RemovedHostSchema>[]> {
    try {
      const raw: unknown = JSON.parse((await dependencies.readQueue()) ?? '[]')
      return Array.isArray(raw)
        ? raw.flatMap((entry) => {
            const parsed = RemovedHostSchema.safeParse(entry)
            return parsed.success ? [parsed.data] : []
          })
        : []
    } catch {
      return []
    }
  }

  async function readSecrets(hostId: string): Promise<RemovedHostSecrets | null> {
    try {
      const parsed = RemovedHostSecretsSchema.safeParse(
        JSON.parse((await dependencies.readSecrets(hostId)) ?? 'null')
      )
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  async function forget(hostIds: readonly string[]): Promise<void> {
    if (hostIds.length === 0) {
      return
    }
    const remaining = (await readEntries()).filter(({ hostId }) => !hostIds.includes(hostId))
    await dependencies.writeQueue(JSON.stringify(remaining))
    await Promise.all(hostIds.map((hostId) => dependencies.deleteSecrets(hostId).catch(() => {})))
  }

  return {
    queue(host: RemovedHostRoute, secrets: RemovedHostSecrets): Promise<void> {
      return serialize(async () => {
        const others = (await readEntries()).filter(({ hostId }) => hostId !== host.hostId)
        const entries = [...others, { ...host, expiresAt: dependencies.now() + RETENTION_MS }]
        const evicted = entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES))
        // Secrets first: an entry without them could never be delivered.
        await dependencies.writeSecrets(host.hostId, JSON.stringify(secrets))
        await dependencies.writeQueue(JSON.stringify(entries.slice(evicted.length)))
        await Promise.all(
          evicted.map(({ hostId }) => dependencies.deleteSecrets(hostId).catch(() => {}))
        )
      })
    },

    cancel(hostId: string): Promise<void> {
      return serialize(() => forget([hostId]))
    },

    flush(): Promise<void> {
      return serialize(async () => {
        const settled: string[] = []
        for (const { expiresAt, ...host } of await readEntries()) {
          const secrets = expiresAt > dependencies.now() ? await readSecrets(host.hostId) : null
          // The live pairing owns the registration of a desktop that was paired again.
          if (
            !secrets ||
            (await dependencies.isPairedAgain(host)) ||
            (await dependencies.deliver(host, secrets).catch(() => false))
          ) {
            settled.push(host.hostId)
          }
        }
        await forget(settled)
      })
    }
  }
}
