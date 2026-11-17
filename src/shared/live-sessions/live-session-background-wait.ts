// What a Claude Code turn that ended left running. An agent that started a command to wait for a
// job still has the move; one that left a server up does not. Nothing here says which by itself:
// `docs/design/agent-status.md` has the rule and the judge that read it.
import type { LiveSubagentStatus } from './live-session-activity'

/**
 * How the session came to have a command. Absent for a call run in the background, which Claude
 * Code reports on and wakes the agent for.
 *
 * - `detached`: a call that returned left it running by itself (`nohup`, `setsid`, `&`, a
 *   detached tmux or screen); only the machine's processes say whether it still runs.
 * - `named`: no call that was read started it; the reply names it and it runs on the machine.
 */
export type BackgroundWaitCommandOrigin = 'detached' | 'named'

export type BackgroundWaitCommand = {
  kind: 'shell' | 'monitor'
  /** Null when its launch lies before what was read of the transcript. */
  command: string | null
  description: string | null
  /** Started since the user last spoke (`final`) or before; null when its launch was not read. */
  turn: 'final' | 'earlier' | null
  startedAt: number | null
  state: LiveSubagentStatus
  /** The programs under its shell right now, by name; null when the host could not say. */
  runs: string[] | null
  origin?: BackgroundWaitCommandOrigin
  /** A subagent of the session started it, not its main thread. */
  subagent?: true
  /** `named` only: what the reply calls it (a script, `PID 4821`). */
  named?: string
}

export type BackgroundWaitEvidence = {
  /** The reply the turn ended on: its first and last words. */
  reply: string | null
  /** When the turn ended (epoch ms, host clock). */
  endedAt: number | null
  /** Claude Code's own state for the session: `shell` is "at my prompt, a command of mine still runs". */
  registry: string | null
  /** The commands still running, and the ones the newest turn started that are over. */
  commands: BackgroundWaitCommand[]
}

/**
 * The rule that needs no model: the agent waits on a command it started since the user last spoke
 * and that still runs. Anything older is a leftover.
 */
export function waitsOnFinalTurnCommand(evidence: BackgroundWaitEvidence): boolean {
  return evidence.commands.some(
    (command) => command.state === 'running' && command.turn === 'final'
  )
}
