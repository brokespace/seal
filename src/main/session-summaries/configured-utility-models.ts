import type { UtilityModelTask } from '../../shared/utility-model/utility-model-selection'
import type { UtilityModelClient } from '../utility-model/utility-model-host'

const RECHECK_MS = 60_000

/** Whether each task's provider has an account on this host, asked again now and then. */
export class ConfiguredUtilityModels {
  private readonly configured: Record<UtilityModelTask, boolean> = {
    summaries: false,
    recaps: false
  }
  private checkedAt = 0
  /** False until the first check has answered: "not configured" then means "not asked yet". */
  known = false

  constructor(private readonly models: Record<UtilityModelTask, UtilityModelClient>) {}

  has(task: UtilityModelTask): boolean {
    return this.configured[task]
  }

  /** The last check is old enough that a config file dropped in since would be missed. */
  due(): boolean {
    return Date.now() - this.checkedAt > RECHECK_MS
  }

  async check(): Promise<void> {
    this.checkedAt = Date.now()
    const [summaries, recaps] = await Promise.all(
      (['summaries', 'recaps'] as const).map((task) =>
        this.models[task].isConfigured().catch(() => false)
      )
    )
    this.configured.summaries = summaries
    this.configured.recaps = recaps
    this.known = true
  }
}
