// Everything a Claude Code session launched to outlive a call: on its main thread, and by its
// subagents in their own transcripts. A subagent's commands are its session's: Claude Code runs
// them under the one agent process.
import { isUnseenDetachedCall, type ClaudeBackgroundLaunch } from './claude-background-launches'
import type { SubagentFileSummary } from './claude-subagent-files'
import type { ClaudeActivityState } from './claude-transcript-activity'

export type SessionLaunch = {
  launch: ClaudeBackgroundLaunch
  /** A subagent made it, in its own transcript. */
  subagent: boolean
}

export function claudeSessionLaunches(
  state: ClaudeActivityState | null | undefined,
  files: readonly SubagentFileSummary[] | undefined
): SessionLaunch[] {
  return [
    ...[...(state?.background.values() ?? [])].map((launch) => ({ launch, subagent: false })),
    ...(files ?? []).flatMap((file) =>
      [...file.launched.background.values()].map((launch) => ({ launch, subagent: true }))
    )
  ]
}

/** The launches that left a task: not a foreground call, nor one whose job no scan ever found. */
export function claudeSessionTasks(
  state: ClaudeActivityState | null | undefined,
  files: readonly SubagentFileSummary[] | undefined
): (SessionLaunch & { launch: { taskId: string } })[] {
  return claudeSessionLaunches(state, files).filter(
    (found): found is SessionLaunch & { launch: { taskId: string } } =>
      found.launch.taskId !== null && !isUnseenDetachedCall(found.launch)
  )
}
