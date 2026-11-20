// One agent's session adapter: which existing piece supplies each capability, as data and pure
// functions. Parts that need the main process are attached under `src/main/live-sessions/adapters/`.
import type { AgentStatusIpcPayload } from '../../agent-status/contracts/agent-status-ipc-payload'
import type { NativeChatTranscriptAgent } from '../../native-chat/native-chat-agent-support'
import type { LiveSession } from '../live-session-types'
import type { AgentSessionAgentId } from './agent-session-agent-ids'

/** The structured runtime that runs an agent headless, as upstream's runtime catalog names it. */
export type AgentSessionChatRuntime = 'claude' | 'codex' | 'pi' | 'acp'

/**
 * What a source observed about a session, for the status module to turn into a status code.
 * No source picks a code itself. To be matched to the status module's own input type when it lands.
 */
export type AgentSessionStatusEvidence = {
  /** A turn is running. */
  turnRunning: boolean
  /** A foreground shell tool is in flight inside the running turn. */
  shellRunning: boolean
  /** An approval prompt waits for the user. */
  pendingApproval: boolean
  /** A question waits for the user. */
  pendingQuestion: boolean
  /** The last turn failed. */
  turnFailed: boolean
  /** Subagents the session waits on. */
  runningSubagents: number
  /** The running turn is blocked on a command or task it started earlier (a pending output or wait call). */
  waitsOnBackgroundTask: boolean
  /** The session has taken at least one turn. */
  hadTurn: boolean
  /** The session closed or its host is gone. */
  ended: boolean
}

/** Where an agent keeps transcripts under its home folder, for the scan that finds external sessions. */
export type AgentTranscriptLocator = {
  /** The variable that moves the agent's home (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). */
  homeEnv: string
  /** Its home under the user's home folder when that variable is unset (`.claude`, `.codex`). */
  defaultHome: string
  /** The folder of transcripts inside that home (`projects`, `sessions`). */
  transcriptsDir: string
  /** A transcript's file name there (`*.jsonl`, `rollout-*.jsonl`). */
  filePattern: string
}

/** What one transcript record says about context usage; folded into the session's `context`. */
export type AgentSessionContextSample = {
  /** Tokens in the context window after this record. */
  usedTokens?: number
  /** The model's window, when the record states it. */
  windowTokens?: number
  model?: string
  /** The record marks a compaction. */
  compacted?: true
  /** Epoch ms of the record. */
  at?: number
}

export type AgentSessionAdapter = {
  agent: AgentSessionAgentId
  /** "Claude Code", "Codex", …: the name notifications and rows use. */
  label: string

  /** Chat: which structured runtime runs it headless, if any. */
  chat?: { runtime: AgentSessionChatRuntime }

  /** CLI in a Seal pane: how its hook rows become a session. Defaults cover most agents. */
  cli?: {
    /** Defaults to upstream's `extractAgentProviderSession`. */
    sessionOf?: (
      row: AgentStatusIpcPayload
    ) => { id: string; cwd?: string; transcriptPath?: string } | null
    /** Extra evidence for the status module, beyond the shared hook mapping. */
    evidenceOf?: (row: AgentStatusIpcPayload) => Partial<AgentSessionStatusEvidence>
    /** How a prompt is answered in the terminal: structured answers, option keys, or not at all. */
    answers: 'ask-steps' | 'option-keys' | 'none'
    /**
     * Argument vector that resumes a session in a terminal, if the agent can. Null when this
     * session cannot be resumed from what is known (Pi resumes by its session file, not its id).
     */
    resumeArgv?: (providerSessionId: string, transcriptPath?: string | null) => string[] | null
  }

  /** External: how to find sessions nobody started through Seal. Claude and Codex today. */
  discovery?: {
    processMatch: (argv: string[]) => boolean
    transcripts: AgentTranscriptLocator
    /** Headless one-shot command that continues a session, used by the `resume` input route. */
    resumeCommand?: (session: LiveSession, text: string) => string
  }

  /** Message history, used by the chat view, summaries, recaps and context usage. */
  transcript?: {
    /** The upstream decoder that reads it. */
    decoder: NativeChatTranscriptAgent
    /** False for Grok, OMP and OpenCode: local files or a Seal server only. */
    remoteReadable: boolean
    usageOf?: (record: unknown) => AgentSessionContextSample | null
  }
}
