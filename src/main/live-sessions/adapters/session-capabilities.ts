import type {
  AgentSessionCapabilityFlags,
  LiveSession
} from '../../../shared/live-sessions/live-session-types'
import { isProvisionalLiveSessionId } from '../../../shared/live-sessions/live-session-provisional-id'
import { liveSessionAdapter } from './live-session-adapters'

function answerCapability(
  session: Pick<LiveSession, 'provider' | 'surface' | 'inputRoutes'>
): AgentSessionCapabilityFlags['answer'] {
  if (session.surface.kind === 'chat') {
    return 'full'
  }
  if (session.surface.kind === 'external') {
    // A dialog on a tmux screen takes an option's keys and nothing else.
    return session.inputRoutes.some((route) => route.kind === 'tmux') ? 'options' : 'none'
  }
  const answers = liveSessionAdapter(session.provider)?.cli?.answers ?? 'none'
  return answers === 'ask-steps' ? 'full' : answers === 'option-keys' ? 'options' : 'none'
}

/** What a session can do on the machine that lists it, from its agent's adapter and where it runs. */
export function sessionCapabilities(
  session: Pick<
    LiveSession,
    'provider' | 'providerSessionId' | 'surface' | 'machine' | 'inputRoutes'
  >
): AgentSessionCapabilityFlags {
  const adapter = liveSessionAdapter(session.provider)
  const chat = session.surface.kind === 'chat'
  const named = !isProvisionalLiveSessionId(session.providerSessionId)
  // A chat's history is its journal; any other session's is the agent's own files.
  const transcript =
    chat ||
    (named &&
      adapter?.transcript !== undefined &&
      (session.machine.kind === 'local' || adapter.transcript.remoteReadable))
  return {
    send: session.inputRoutes.length > 0,
    answer: answerCapability(session),
    transcript,
    recap: transcript,
    context: chat ? 'exact' : adapter?.transcript?.usageOf ? 'estimated' : 'none',
    switchSurface: {
      toChat: !chat && named && adapter?.chat !== undefined,
      toCli: chat && named && adapter?.cli?.resumeArgv !== undefined
    },
    takeOver: session.surface.kind === 'external' && named && adapter?.discovery !== undefined
  }
}
