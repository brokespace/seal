// The live-session registry's public contract: plain JSON, shared by main, preload, renderer and RPC.
import type { LiveSessionRecapBrief } from '../session-recap/session-recap-types'
import type { NativeChatMessage } from '../native-chat/native-chat-types'
import type { LiveSessionActivity } from './live-session-activity'

export const LIVE_SESSION_PROVIDERS = ['claude', 'codex'] as const
export type LiveSessionProvider = (typeof LIVE_SESSION_PROVIDERS)[number]

/**
 * working           a turn is running
 * waiting-subagent  the agent waits for subagents it started (still busy, nothing for the user to do)
 * waiting-task      the agent waits for background commands it started
 * needs-permission  a permission prompt is up
 * waiting-input     the agent asked the user something
 * idle              the agent is running at an empty prompt with nothing pending
 * done              the agent process has ended
 * errored           the last turn failed
 */
export const LIVE_SESSION_STATUSES = [
  'working',
  'waiting-subagent',
  'waiting-task',
  'waiting-input',
  'needs-permission',
  'idle',
  'done',
  'errored'
] as const
export type LiveSessionStatus = (typeof LIVE_SESSION_STATUSES)[number]

/** Where a status came from, strongest first. */
export type LiveSessionStatusSource = 'seal-hooks' | 'agent-hooks' | 'screen' | 'transcript'

export type LiveSessionMachine = {
  /** `local`, or the machine's record id (its original SSH target or server id, so ids survive merges). */
  hostId: string
  label: string
  kind: 'local' | 'remote'
  /** The unified machine; absent only on sessions saved before machines were unified. */
  machineId?: string
  /** Where take-over opens its workspace: the transport the machine uses now. */
  executionHostId?: string
  connection?: 'local' | 'ssh' | 'server'
}

/** How a message reaches the session, in the order delivery tries them. */
export type LiveSessionInputRoute =
  /** A Seal (Orca) terminal pane, through the runtime's own prompt writer. */
  | { kind: 'seal-pane'; paneKey: string }
  /** Codex's own queue (`codex queue`): a real user turn, after any running one, never in a draft. */
  | { kind: 'codex-queue'; thread: string; binary: string | null; codexHome: string | null }
  /** A tmux pane on the session's machine: bracketed paste at a free prompt. */
  | { kind: 'tmux'; target: string; socket?: string }
  /** No live terminal: the provider CLI resumes the session headless in the background. */
  | { kind: 'resume' }

export type LiveSessionPermissionOption = { id: string; label: string }

export type LiveSessionPermissionPrompt = {
  /** Changes whenever a different prompt is up, so a late answer can't hit the next one. */
  promptId: string
  question: string
  options: LiveSessionPermissionOption[]
}

export type LiveSession = {
  /** `<hostId>:<provider>:<providerSessionId>`; stable across rescans and restarts. */
  id: string
  provider: LiveSessionProvider
  providerSessionId: string
  machine: LiveSessionMachine
  /** Launched from Seal (an Orca pane) or found running outside it. */
  origin: 'seal' | 'external'
  cwd: string | null
  /** The cwd's last path segment. */
  project: string | null
  title: string | null
  status: LiveSessionStatus
  statusSource: LiveSessionStatusSource
  /** One line on what it is doing or waiting on ("Bash: pnpm test", "Allow Edit?"). */
  statusDetail: string | null
  /** Epoch ms of the newest transcript record, hook event or process sighting. */
  lastActivityAt: number
  startedAt: number | null
  /** The agent CLI process is running. */
  alive: boolean
  pid: number | null
  transcriptPath: string | null
  inputRoutes: LiveSessionInputRoute[]
  permission: LiveSessionPermissionPrompt | null
  /** Subagents, background tasks and the todo list; absent from hosts that report none. */
  activity?: LiveSessionActivity
  /** The agent's newest message, one line. */
  lastMessage?: string | null
  /** The name the user gave it in Seal; shown instead of `title`. */
  customTitle?: string | null
  /** The provider config folder it runs under (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`), which names its account. */
  configDir?: string | null
  /** The user pinned it to the top of its machine in Seal. */
  pinned?: boolean
  /** Ids this session went by before it was resumed into a new transcript; it is still that session. */
  continues?: string[]
  /** One sentence on what the agent did or needs, made by the host that owns the session when it stopped. */
  summary?: string
  /** That summary is being made. */
  summaryPending?: true
  /** `title` is a name the user gave it in the agent itself (Claude's `/rename`), not a prompt or a summary. */
  titleNamed?: true
  /** Its rolling recap in brief: the title a row shows and what is still open for the user. */
  recap?: LiveSessionRecapBrief
}

/** What the user sets on a session in Seal; an absent field is left as it is. */
export type LiveSessionAnnotation = {
  sessionId: string
  /** Null or blank goes back to the agent's own title. */
  customTitle?: string | null
  pinned?: boolean
}

export type LiveSessionRegistrySnapshot = {
  revision: number
  sessions: LiveSession[]
  /** Hosts whose last scan failed, with why; their sessions keep their last state. */
  hostErrors: Record<string, string>
}

export type LiveSessionRegistryEvent =
  | { type: 'snapshot'; snapshot: LiveSessionRegistrySnapshot }
  | { type: 'upsert'; revision: number; session: LiveSession }
  /** `replacedBy`: the same session under the id its transcript gave it (first prompt of a fresh agent). */
  | { type: 'remove'; revision: number; sessionId: string; replacedBy?: string }
  | { type: 'host-error'; revision: number; hostId: string; error: string | null }

/** A transcript byte offset: every message's position, and where a reader resumes. */
export type LiveTranscriptCursor = number

export type LiveTranscriptPage = {
  sessionId: string
  messages: NativeChatMessage[]
  /** Read from here next to get only newer messages. */
  cursor: LiveTranscriptCursor
  /** Offset of the oldest message returned; pass as `before` to page back. */
  start: LiveTranscriptCursor
  /** Older messages exist before `start`. */
  more: boolean
}

export type LiveTranscriptDelta = {
  sessionId: string
  /** The cursor this delta continues from; a client whose cursor differs re-reads from its own. */
  from: LiveTranscriptCursor
  cursor: LiveTranscriptCursor
  messages: NativeChatMessage[]
  /** The file shrank or was replaced; drop what you hold and re-read. */
  reset?: true
}

export const LIVE_MESSAGE_STATES = ['queued', 'sending', 'sent', 'delivered', 'failed'] as const
/**
 * queued     Seal has it; it waits its turn or for the prompt to be free
 * sending    being typed right now (never shown as final)
 * sent       handed to the session, not in its transcript yet
 * delivered  the transcript holds it as the user's message
 * failed     it can't get there; `error` says why and a retry is safe
 */
export type LiveMessageState = (typeof LIVE_MESSAGE_STATES)[number]

export type LiveMessage = {
  /** Client-chosen id; sending the same id again never delivers twice. */
  messageId: string
  sessionId: string
  text: string
  state: LiveMessageState
  route: LiveSessionInputRoute['kind'] | null
  error: string | null
  createdAt: number
  updatedAt: number
}

export type LiveSendRequest = { sessionId: string; messageId: string; text: string }

export type LivePermissionAnswer = { sessionId: string; promptId: string; optionId: string }

export type LivePermissionAnswerResult =
  | { ok: true }
  | {
      ok: false
      reason: 'prompt_not_pending' | 'option_not_offered' | 'not_answerable' | 'failed'
      error?: string
    }

/** Take over: the external process is stopped; reopen it in a Seal pane with these. */
export type LiveTakeOverResult =
  | {
      ok: true
      provider: LiveSessionProvider
      providerSessionId: string
      cwd: string | null
      machine: LiveSessionMachine
      transcriptPath: string | null
      /** Codex sessions outside the default home resume only with their CODEX_HOME. */
      codexHome: string | null
    }
  | {
      ok: false
      reason: 'not_found' | 'not_external' | 'not_resumable' | 'still_running' | 'failed'
      error?: string
    }

/** Remove from Seal: hidden for good; optionally stopped first and its transcript deleted. */
export type LiveRemoveRequest = {
  sessionIds: string[]
  /** End a running agent (and its Seal tmux pane) before hiding it. */
  stop: boolean
  deleteTranscripts: boolean
  /** Only stop: the session stays in Seal, ended, so it can be resumed or removed later. */
  keep?: boolean
}

export type LiveRemoveResult = {
  removed: string[]
  failed: { sessionId: string; reason: 'still_running' | 'failed'; error?: string }[]
}
