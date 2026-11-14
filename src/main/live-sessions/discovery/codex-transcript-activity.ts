// A Codex session's plan: each `update_plan` call replaces the one before.
import type { LiveTodo } from '../../../shared/live-sessions/live-session-activity'
import { LIVE_TODO_STATUSES } from '../../../shared/live-sessions/live-session-activity'
import { jsonField, oneLine, rec, str } from './transcript-records'
import type { TranscriptRecord } from './transcript-records'

/** The newest plan in these records, or `previous` when they hold none. */
export function codexPlan(
  records: TranscriptRecord[],
  previous: LiveTodo[] | null
): LiveTodo[] | null {
  for (let i = records.length - 1; i >= 0; i--) {
    const payload = rec(records[i].payload)
    if (
      records[i].type !== 'response_item' ||
      payload?.type !== 'function_call' ||
      payload.name !== 'update_plan'
    ) {
      continue
    }
    const plan = jsonField(payload.arguments)?.plan
    if (Array.isArray(plan)) {
      return plan.flatMap((entry): LiveTodo[] => {
        const item = rec(entry)
        const step = str(item?.step)
        return step
          ? [
              {
                content: oneLine(step, 200),
                status: LIVE_TODO_STATUSES.find((status) => status === item?.status) ?? 'pending'
              }
            ]
          : []
      })
    }
  }
  return previous
}
