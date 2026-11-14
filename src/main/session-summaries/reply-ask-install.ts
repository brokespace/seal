import { join } from 'node:path'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import type { UtilityModelClient } from '../utility-model/utility-model-host'
import { lastAssistantText } from './last-assistant-text'
import { LiveSessionReplyAsks } from './live-session-reply-asks'
import { REPLY_ASK_TASK } from './reply-ask-task'
import { SessionSummarizer } from './session-summarizer'
import { SessionSummaryCache } from './session-summary-cache'
import { unrefTimer } from './unref-timer'

export type ReplyAskClassifier = {
  decorate(session: LiveSession): LiveSession
  /** The model came back: ask again for the replies it failed on. */
  retryFailed(): void
  dispose(): void
}

/**
 * The fallback of session status detection (docs/session-status.md), watching this host's sessions
 * until disposed. It keeps a cache file of its own.
 */
export function createReplyAskClassifier(options: {
  liveSessions: LiveSessionService
  userDataPath: string
  model: () => UtilityModelClient
  enabled: () => boolean
  onChange: () => void
  log: (message: string, error?: unknown) => void
}): ReplyAskClassifier {
  const { liveSessions, log } = options
  const cache = new SessionSummaryCache(
    join(options.userDataPath, 'session-summaries', 'reply-asks.json'),
    log
  )
  void cache.load()
  const classifier = new SessionSummarizer({
    complete: async (request, signal) => (await options.model().complete(request, signal)).text,
    enabled: options.enabled,
    cache,
    onChange: options.onChange,
    task: REPLY_ASK_TASK,
    setTimer: unrefTimer
  })
  const live = new LiveSessionReplyAsks({
    classifier,
    lastAssistantText: (sessionId) => lastAssistantText(liveSessions, sessionId),
    log
  })
  const release = liveSessions.subscribe((event) => live.observe(event))
  return {
    decorate: (session) => live.decorate(session),
    retryFailed: () => classifier.retryFailed(),
    dispose: () => {
      release()
      live.dispose()
      classifier.dispose()
    }
  }
}
