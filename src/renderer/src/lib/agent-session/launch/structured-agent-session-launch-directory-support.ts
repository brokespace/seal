import { AGENT_SESSION_CREATE_LAUNCH_DIRECTORY_RUNTIME_CAPABILITY } from '../../../../../shared/agent-session/agent-session-create-capabilities'
import { structuredAgentSessionHostCapabilityState } from '@/runtime/native-chat/host-capabilities/structured-agent-session-host-support'
import { abandonStructuredAgentSessionLaunchIntent } from './structured-agent-session-launch-abandon'
import {
  StructuredAgentSessionCreateRefusalError,
  StructuredAgentSessionCreateUnknownOutcomeError
} from './structured-agent-session-launch-errors'
import type { StructuredAgentSessionLaunchIntent } from './structured-agent-session-launch-intent'

/** A host that does not read `launchDirectory` would start the chat at the workspace root, so nothing is sent to it. */
export async function requireHostLaunchDirectorySupport(
  intent: StructuredAgentSessionLaunchIntent
): Promise<void> {
  if (!intent.params.launchDirectory) {
    return
  }
  const support = await structuredAgentSessionHostCapabilityState(
    intent.target,
    AGENT_SESSION_CREATE_LAUNCH_DIRECTORY_RUNTIME_CAPABILITY
  )
  if (support === 'supported') {
    return
  }
  // An unanswered probe may follow a create whose reply was lost, so it settles nothing.
  if (support === 'unknown') {
    throw new StructuredAgentSessionCreateUnknownOutcomeError(
      'The host could not say whether it starts chats in a subfolder.',
      'runtime_unavailable'
    )
  }
  abandonStructuredAgentSessionLaunchIntent(intent)
  // The unsupported code lets a default launch open its terminal in that folder instead.
  throw new StructuredAgentSessionCreateRefusalError(
    'The host cannot start a chat in a workspace subfolder.',
    'structured_agent_session_unsupported',
    { code: 'structured_agent_session_unsupported', details: { reason: 'hostUnsupported' } }
  )
}
