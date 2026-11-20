import { claudeStartFailure } from '../sdk-transport/claude-startup-failure'
import { AgentSessionStartFailure } from '../../native-chat/agent-session-wire/startup/structured-agent-session-start-failure'
import { withProviderRequestTimeout } from '../../provider-process/provider-request-timeout'
import {
  providerDiagnostic,
  withProviderDiagnostic
} from '../../../shared/agent-session/failures/agent-session-failure'
import type { ClaudeStreamJsonConnection } from '../claude-stream-json-connection'
import type { ClaudeInitProof } from './claude-structured-init-proof'

/** Well past slow healthy starts, well before the host ceiling: a CLI that holds a SessionStart
 *  hook in the foreground (an `asyncRewake` hook beside an `alwaysLoad` MCP server) never answers. */
export const CLAUDE_INITIALIZE_TIMEOUT_MS = 180_000
/** Claude answers initialize within a second of starting its hooks once it reads its input; a
 *  fresh start this slow beside a running `asyncRewake` hook lost that race, which a new process
 *  almost always wins. Only once per chat: a slow synchronous hook looks the same. */
export const CLAUDE_HELD_START_RESTART_MS = 30_000
const restartedHeldStarts = new Set<string>()

function startupDeadline(
  ms: number,
  timers: ReturnType<typeof setTimeout>[],
  failure: () => Error | null
): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const timer = setTimeout(() => {
      const error = failure()
      if (error) {
        reject(error)
      }
    }, ms)
    timer.unref?.()
    timers.push(timer)
  })
}

function claudeInitializeTimeout(initProof: ClaudeInitProof): Error {
  const hooks = initProof.runningStartupHooks()
  const error = new Error(
    `claude did not answer initialize within ${CLAUDE_INITIALIZE_TIMEOUT_MS}ms`
  )
  return withProviderRequestTimeout(
    withProviderDiagnostic(
      error,
      hooks > 0
        ? providerDiagnostic(
            `Claude was still running ${hooks} SessionStart hook${hooks === 1 ? '' : 's'} from its settings. It does not answer until they finish.`,
            'person'
          )
        : undefined
    ),
    { method: 'initialize', timeoutMs: CLAUDE_INITIALIZE_TIMEOUT_MS }
  )
}

/** Rejects a start whose initialize Claude leaves unanswered too long; `clear` once it settles. */
export function claudeStartupDeadlines(input: {
  connection: Pick<ClaudeStreamJsonConnection, 'startupFailure' | 'rewakeHookMayHold'>
  initProof: ClaudeInitProof
  sessionId: string
}): { expired: Promise<never>; clear: () => void } {
  const timers: ReturnType<typeof setTimeout>[] = []
  // The attempt after a held-start restart waits for the initialize deadline.
  const retried = restartedHeldStarts.delete(input.sessionId)
  const restartable = input.connection.rewakeHookMayHold === true && !retried
  const expired = Promise.race([
    startupDeadline(CLAUDE_INITIALIZE_TIMEOUT_MS, timers, () =>
      claudeStartFailure([
        input.connection.startupFailure?.(),
        claudeInitializeTimeout(input.initProof)
      ])
    ),
    startupDeadline(CLAUDE_HELD_START_RESTART_MS, timers, () => {
      if (!restartable || input.initProof.runningStartupHooks() === 0) {
        return null
      }
      restartedHeldStarts.add(input.sessionId)
      const held = `claude held initialize behind a SessionStart hook for ${CLAUDE_HELD_START_RESTART_MS}ms`
      return new AgentSessionStartFailure(new Error(held), 'safe')
    })
  ])
  return { expired, clear: () => timers.forEach(clearTimeout) }
}
