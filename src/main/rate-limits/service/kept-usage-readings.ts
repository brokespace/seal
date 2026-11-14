import { readFileSync } from 'node:fs'
import { z } from 'zod'
import type { ProviderRateLimits } from '../../../shared/rate-limit-types'
import { writeSecureJsonFile } from '../../../shared/secure-storage/secure-file'
import { LONG_STALE_THRESHOLD_MS } from './service-types'

const SAVE_DELAY_MS = 30_000

type KeptReading = {
  /** The login the reading describes, where the reader could name it. */
  identity?: string
  limits: ProviderRateLimits
}

const FileSchema = z.object({
  readings: z.record(
    z.string(),
    z.object({
      identity: z.string().optional(),
      limits: z.looseObject({
        provider: z.string(),
        updatedAt: z.number(),
        status: z.literal('ok')
      })
    })
  )
})

function readFile(path: string): Map<string, KeptReading> {
  try {
    const parsed = FileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
    if (!parsed.success) {
      return new Map()
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: entries were written by this store from typed readings; a malformed file is dropped whole.
    return new Map(Object.entries(parsed.data.readings as unknown as Record<string, KeptReading>))
  } catch {
    return new Map()
  }
}

/**
 * The last good reading of each login, kept across restarts: a check the endpoint refuses right
 * after a start then still has figures to show, dated when they were read.
 */
export class KeptUsageReadings {
  private readings: Map<string, KeptReading> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly path: string) {}

  private all(): Map<string, KeptReading> {
    this.readings ??= readFile(this.path)
    return this.readings
  }

  /** A reading kept for another identity never stands in for this one. */
  get(key: string, identity?: string): ProviderRateLimits | null {
    const kept = this.all().get(key)
    return kept && kept.identity === identity ? kept.limits : null
  }

  keep(key: string, limits: ProviderRateLimits, identity?: string): void {
    if (limits.status !== 'ok') {
      return
    }
    this.all().set(key, { ...(identity ? { identity } : {}), limits })
    this.saveTimer ??= setTimeout(() => this.flush(), SAVE_DELAY_MS)
    this.saveTimer.unref?.()
  }

  flush(): void {
    if (!this.saveTimer) {
      return
    }
    clearTimeout(this.saveTimer)
    this.saveTimer = null
    const now = Date.now()
    const readings = Object.fromEntries(
      [...this.all()].filter(([, kept]) => now - kept.limits.updatedAt < LONG_STALE_THRESHOLD_MS)
    )
    try {
      writeSecureJsonFile(this.path, { readings })
    } catch (error) {
      console.warn('[rate-limits] Could not keep usage readings:', error)
    }
  }
}
