import { formatNativeChatFileReference } from '../../../../../shared/agent-image-paste'
import type { StructuredAgentContextUsage } from '../../../../../shared/agent-session/structured-agent-session-context-usage'
import type { AgentSessionCapabilityFlags } from '../../../../../shared/live-sessions/live-session-types'
import type { NativeChatContextUsageSummary } from '../../../../../shared/native-chat/native-chat-context-usage-summary'
import type {
  NativeChatComposerSessionPlace,
  NativeChatStructuredComposerTransport
} from '../../native-chat/composer/submit/native-chat-structured-composer-transport'

export type ExternalAgentSessionComposerInput = {
  /** The record id. */
  sessionId: string
  capabilities: AgentSessionCapabilityFlags
  worktreeId: string
  /** The paired server the tab's workspace is on; null on this machine or over SSH. */
  runtimeEnvironmentId: string | null
  /** Where the record says the session runs; null while the registry lists none. */
  sessionPlace: NativeChatComposerSessionPlace | null
  /** Said by the composer when a workspace on a paired server takes no file from this machine. */
  attachmentsUnavailableNotice: string
  /** Said by the disabled Send button while `capabilities.send` is false. */
  sendUnavailableReason: string
  /** The session's context as its transcript and record state it; null while neither does. */
  context: NativeChatContextUsageSummary | null
  /** Queues the text for the session; the registry picks the route. */
  send: (text: string) => void
  onError: NativeChatStructuredComposerTransport['onError']
  onSubmitted?: () => void
  captureAdmittedReveal?: () => () => void
}

const NO_OPTIONS: NativeChatStructuredComposerTransport['optionsSurface'] = {
  getSnapshot: () => [],
  setOption: async () => ({ snapshot: [] }),
  invokeAction: async () => ({ snapshot: [] }),
  subscribe: () => () => {}
}

/** The composer ring reads a structured host's report; the same numbers in that shape. */
function contextUsageReport({
  rows,
  ...measured
}: NativeChatContextUsageSummary): StructuredAgentContextUsage {
  return {
    ...measured,
    categories: rows.map((row) => ({
      name: row.name,
      tokens: row.tokens,
      ...(row.deferred ? { deferred: true as const } : {})
    }))
  }
}

/**
 * What the composer can do for a session Seal does not host. The registry takes text only, so
 * every send (a message, a slash command, a mention, a file as its path) goes as plain text, and
 * the members a structured host adds (model and effort, plan mode, compact, goal, fork, side
 * chat, account usage, queue-or-steer, image input) are left out, which hides their controls.
 */
export function externalAgentSessionComposerTransport(
  input: ExternalAgentSessionComposerInput
): NativeChatStructuredComposerTransport {
  const onPairedServer = input.runtimeEnvironmentId !== null
  return {
    sessionId: input.sessionId,
    worktreeId: input.worktreeId,
    runtimeEnvironmentId: input.runtimeEnvironmentId,
    sessionPlace: input.sessionPlace,
    runtime: onPairedServer ? 'remote' : 'local',
    // Why: an upload goes into a structured session's store, which this session has none of.
    ...(onPairedServer
      ? { sessionPending: true, sessionPendingNotice: input.attachmentsUnavailableNotice }
      : {}),
    capturePresentation: () => () => true,
    optionsSurface: NO_OPTIONS,
    optionSnapshot: [],
    acceptsImages: false,
    contextUsage:
      input.capabilities.context === 'none' || !input.context
        ? null
        : contextUsageReport(input.context),
    ...(input.capabilities.send ? {} : { sendBlockedReason: input.sendUnavailableReason }),
    // Why unhandled: no host runs commands here; the session's own agent reads them as text.
    dispatchCommand: async () => ({ handled: false, accepted: false, error: null }),
    send: (text, attachments) => {
      if (!input.capabilities.send) {
        return false
      }
      input.send(
        [text, ...attachments.map((file) => formatNativeChatFileReference(file.path))].join('\n')
      )
      return true
    },
    onError: input.onError,
    ...(input.onSubmitted ? { onSubmitted: input.onSubmitted } : {}),
    ...(input.captureAdmittedReveal ? { captureAdmittedReveal: input.captureAdmittedReveal } : {})
  }
}
