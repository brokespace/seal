import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type { UtilityModelHost } from '../utility-model/utility-model-host'
import { createLiveSessionBackgroundWaits } from './live-session-background-waits'
import { createReplyAskClassifier, type ReplyAskClassifier } from './reply-ask-install'

type ReplyAskOptions = Parameters<typeof createReplyAskClassifier>[0]

/**
 * What models add to the status of a finished turn on this host (docs/design/agent-status.md):
 * whether the agent waits on a command it left running, and whether its reply asks.
 */
export function createSessionStatusJudges(
  options: ReplyAskOptions & {
    /**
     * This host's Clef, which the background wait judge alone runs on whatever model writes the
     * summaries. Absent on a host with no judge: an injected model brings none.
     */
    decisions?: Pick<UtilityModelHost, 'clef' | 'provider'>
  }
): ReplyAskClassifier {
  const replyAsks = createReplyAskClassifier(options)
  const waits = options.decisions
    ? createLiveSessionBackgroundWaits({
        models: options.decisions,
        userDataPath: options.userDataPath,
        onChange: options.onChange,
        log: options.log
      })
    : null
  return {
    ...replyAsks,
    // The wait first: a turn that waits on its own command has handed the user no reply to answer.
    decorate: (session: LiveSession) => replyAsks.decorate(waits?.decorate(session) ?? session),
    dispose: () => {
      waits?.dispose()
      replyAsks.dispose()
    }
  }
}
