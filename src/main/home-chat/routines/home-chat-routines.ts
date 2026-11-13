import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomically } from '../../filesystem/atomic-file-publication'
import { isRecord } from '../home-chat-record-guard'
import { isValidAutomationSchedule } from '../../../shared/automations/scheduling/automation-schedule-parsing'
import { nextAutomationOccurrenceAfter } from '../../../shared/automations/scheduling/automation-schedule-occurrences'
import { formatAutomationSchedule } from '../../../shared/automations/scheduling/automation-schedules'

export type HomeChatRoutine = {
  id: string
  chatId: string
  name: string
  /** 5-field cron (minute hour day month weekday) in local time, or an RRULE. */
  schedule: string
  /** What the assistant is asked to do each time it fires. */
  prompt: string
  enabled: boolean
  /** Disable after the first run. */
  once: boolean
  createdAt: number
  nextRunAt: number | null
  lastRunAt?: number
}

export type HomeChatRoutinesDeps = {
  rootDir: string
  onFire: (routine: HomeChatRoutine) => void
  now?: () => number
}

// Re-arm at least hourly so sleep or clock changes never strand a routine.
const MAX_TIMER_MS = 60 * 60_000

function isRoutine(value: unknown): value is HomeChatRoutine {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.schedule === 'string' &&
    typeof value.prompt === 'string'
  )
}

export function describeRoutine(routine: HomeChatRoutine): string {
  const next =
    routine.enabled && routine.nextRunAt ? new Date(routine.nextRunAt).toString() : 'not scheduled'
  return `${routine.id} "${routine.name}": ${formatAutomationSchedule(routine.schedule)} (${routine.schedule})${routine.once ? ', once' : ''}${routine.enabled ? '' : ', paused'}; next run ${next}\n  prompt: ${routine.prompt}`
}

/** Recurring assistant runs on Orca's cron engine; each run is a turn in the routine's chat. */
export class HomeChatRoutines {
  private readonly routines = new Map<string, HomeChatRoutine>()
  private readonly path: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly now: () => number

  constructor(private readonly deps: HomeChatRoutinesDeps) {
    this.path = join(deps.rootDir, 'routines.json')
    this.now = deps.now ?? Date.now
  }

  async load(): Promise<void> {
    const raw: unknown = await readFile(this.path, 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => [])
    for (const routine of Array.isArray(raw) ? raw.filter(isRoutine) : []) {
      this.routines.set(routine.id, routine)
    }
    // Runs missed while Seal was closed fire once now.
    this.tick()
  }

  list(chatId?: string): HomeChatRoutine[] {
    return [...this.routines.values()].filter((r) => !chatId || r.chatId === chatId)
  }

  create(args: {
    chatId: string
    name: string
    schedule: string
    prompt: string
    once?: boolean
  }): HomeChatRoutine {
    const schedule = args.schedule.trim()
    if (!isValidAutomationSchedule(schedule)) {
      throw new Error(
        `"${schedule}" is not a schedule Seal can run. Use 5-field cron in local time, e.g. "0 9 * * 1-5" for weekdays at 9:00 or "*/15 * * * *" for every 15 minutes.`
      )
    }
    const createdAt = this.now()
    const routine: HomeChatRoutine = {
      id: randomUUID().slice(0, 8),
      chatId: args.chatId,
      name: args.name.trim() || 'Routine',
      schedule,
      prompt: args.prompt.trim(),
      enabled: true,
      once: args.once === true,
      createdAt,
      nextRunAt: nextAutomationOccurrenceAfter(schedule, createdAt, createdAt)
    }
    this.routines.set(routine.id, routine)
    this.persistAndArm()
    return routine
  }

  update(
    id: string,
    patch: Partial<Pick<HomeChatRoutine, 'name' | 'schedule' | 'prompt' | 'enabled' | 'once'>>
  ): HomeChatRoutine {
    const routine = this.get(id)
    if (patch.schedule !== undefined && !isValidAutomationSchedule(patch.schedule.trim())) {
      throw new Error(`"${patch.schedule}" is not a valid schedule.`)
    }
    Object.assign(routine, {
      ...patch,
      ...(patch.schedule !== undefined ? { schedule: patch.schedule.trim() } : {})
    })
    routine.nextRunAt = routine.enabled
      ? nextAutomationOccurrenceAfter(routine.schedule, routine.createdAt, this.now())
      : null
    this.persistAndArm()
    return routine
  }

  delete(id: string): HomeChatRoutine {
    const routine = this.get(id)
    this.routines.delete(routine.id)
    this.persistAndArm()
    return routine
  }

  deleteForChat(chatId: string): void {
    for (const routine of this.list(chatId)) {
      this.routines.delete(routine.id)
    }
    this.persistAndArm()
  }

  runNow(id: string): HomeChatRoutine {
    const routine = this.get(id)
    this.fire(routine)
    this.persistAndArm()
    return routine
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private get(id: string): HomeChatRoutine {
    const routine = this.routines.get(id.trim())
    if (!routine) {
      throw new Error(`No routine ${id}. List routines to see their ids.`)
    }
    return routine
  }

  private fire(routine: HomeChatRoutine): void {
    const now = this.now()
    routine.lastRunAt = now
    if (routine.once) {
      routine.enabled = false
      routine.nextRunAt = null
    } else {
      routine.nextRunAt = nextAutomationOccurrenceAfter(routine.schedule, routine.createdAt, now)
    }
    this.deps.onFire(routine)
  }

  /** Fire everything due, then sleep until the next routine. */
  tick(): void {
    const now = this.now()
    for (const routine of this.routines.values()) {
      if (routine.enabled && routine.nextRunAt !== null && routine.nextRunAt <= now) {
        this.fire(routine)
      }
    }
    this.persistAndArm()
  }

  private persistAndArm(): void {
    writeFileAtomically(this.path, JSON.stringify([...this.routines.values()], null, 2))
    if (this.timer) {
      clearTimeout(this.timer)
    }
    const next = Math.min(
      ...[...this.routines.values()].flatMap((r) => (r.enabled && r.nextRunAt ? [r.nextRunAt] : []))
    )
    if (!Number.isFinite(next)) {
      this.timer = null
      return
    }
    const delay = Math.max(1_000, Math.min(MAX_TIMER_MS, next - this.now()))
    this.timer = setTimeout(() => this.tick(), delay)
    this.timer.unref?.()
  }
}
