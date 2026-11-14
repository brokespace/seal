import { join } from 'node:path'
import type { AgentPaneChange } from '../agent-hooks/observations/agent-transition-detector'
import type { AgentStatusIpcPayload } from '../../shared/agent-status/contracts/agent-status-ipc-payload'
import type { LiveSession } from '../../shared/live-sessions/live-session-types'
import type {
  SessionSummariesListResult,
  SessionSummariesStatus,
  SessionSummarySettings
} from '../../shared/session-summaries/session-summary-contracts'
import type { LiveSessionService } from '../live-sessions/live-session-service'
import { getUtilityModelHost } from '../utility-model/utility-model-host'
import type { UtilityModelService } from '../utility-model/utility-model-service'
import { LiveSessionSummaries, type LiveSessionSummariesDeps } from './live-session-summaries'
import { PaneSessionSummaries } from './pane-session-summaries'
import { SessionSummarizer } from './session-summarizer'
import { SessionSummaryCache } from './session-summary-cache'
import { getSessionSummariesHost, setSessionSummariesHost } from './session-summaries-instance'

type SummarySettingsStore = {
  getSettings(): SessionSummarySettings
  updateSettings(updates: SessionSummarySettings): unknown
  onSettingsChanged(listener: (updates: Partial<SessionSummarySettings>) => void): unknown
}

type SummaryRuntime = {
  agentTransitions: {
    subscribe(listener: (change: AgentPaneChange) => void): () => void
    latestRow(paneKey: string): AgentStatusIpcPayload | null
    trackedPaneSeeds(): AgentPaneChange[]
  }
}

export type SessionSummariesInstallOptions = {
  runtime: SummaryRuntime
  store: SummarySettingsStore
  userDataPath: string
  /** The desktop's session registry; a headless server has none and summarizes its panes only. */
  liveSessions?: LiveSessionService | null
  serverSummaries?: LiveSessionSummariesDeps['serverSummaries']
  /** A pane's summary changed: clients reading agent rows should read again. */
  onPaneSummaryChanged?: () => void
  utilityModel?: UtilityModelService
}

const CONFIGURED_RECHECK_MS = 60_000
const TRANSCRIPT_TAIL_MESSAGES = 30

function unrefTimer(run: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** The newest thing the agent itself said: assistant prose, never tool calls, tool output or reasoning. */
async function lastAssistantText(
  liveSessions: LiveSessionService,
  sessionId: string
): Promise<string | null> {
  const page = await liveSessions.transcriptPage(sessionId, null, TRANSCRIPT_TAIL_MESSAGES)
  for (let index = page.messages.length - 1; index >= 0; index--) {
    const message = page.messages[index]
    if (message.role !== 'assistant') {
      continue
    }
    const text = message.blocks
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
      .trim()
    if (text) {
      return text
    }
  }
  return null
}

/** Session status summaries on this host: what makes them, and what clients read. */
export class SessionSummariesHost {
  private readonly utility: UtilityModelService
  private readonly summarizer: SessionSummarizer
  private readonly panes: PaneSessionSummaries
  private readonly live: LiveSessionSummaries | null
  private readonly releases: (() => void)[] = []
  private configured = false
  private configuredCheckedAt = 0
  private available = false
  private republishQueued = false

  constructor(private readonly options: SessionSummariesInstallOptions) {
    const log = (message: string, error?: unknown) => console.warn(message, error ?? '')
    const { liveSessions } = options
    this.utility = options.utilityModel ?? getUtilityModelHost().service
    const cache = new SessionSummaryCache(
      join(options.userDataPath, 'session-summaries', 'cache.json'),
      log
    )
    void cache.load()
    this.summarizer = new SessionSummarizer({
      complete: async (request, signal) => (await this.utility.complete(request, signal)).text,
      enabled: () => this.isAvailable(),
      cache,
      onChange: () => this.republishSoon(),
      setTimer: unrefTimer
    })
    this.panes = new PaneSessionSummaries({
      summarizer: this.summarizer,
      readHookRow: (paneKey) => options.runtime.agentTransitions.latestRow(paneKey),
      setTimer: unrefTimer
    })
    this.live = liveSessions
      ? new LiveSessionSummaries({
          summarizer: this.summarizer,
          lastAssistantText: (sessionId) => lastAssistantText(liveSessions, sessionId),
          paneView: (paneKey) => this.panes.view(paneKey),
          serverSummaries: options.serverSummaries,
          onChange: () => this.republishSoon(),
          setTimer: unrefTimer,
          log
        })
      : null
  }

  start(): void {
    const { runtime, store, liveSessions } = this.options
    this.releases.push(
      runtime.agentTransitions.subscribe((change) => this.panes.observe(change)),
      // Deferred: health changes fire from inside the request that noticed them.
      this.utility.subscribe(() => queueMicrotask(() => void this.refreshAvailability(true)))
    )
    // Both hosts attach hook status before this starts; its panes were seeded with nobody listening.
    for (const seed of runtime.agentTransitions.trackedPaneSeeds()) {
      this.panes.observe(seed)
    }
    store.onSettingsChanged((updates) => {
      if ('sessionSummariesEnabled' in updates) {
        void this.refreshAvailability(false)
        this.republishSoon()
      }
    })
    if (liveSessions && this.live) {
      const live = this.live
      liveSessions.registry.setDecorator((session) => this.decorate(session))
      this.releases.push(liveSessions.subscribe((event) => live.observe(event)))
    }
    void this.refreshAvailability(true)
  }

  dispose(): void {
    for (const release of this.releases.splice(0)) {
      release()
    }
    this.options.liveSessions?.registry.setDecorator(null)
    this.panes.dispose()
    this.live?.dispose()
    this.summarizer.dispose()
  }

  /** A pane agent's summary for clients reading agent rows; null while off or when it has none. */
  paneSummary(paneKey: string): string | null {
    return this.settingOn() ? (this.panes.view(paneKey)?.text ?? null) : null
  }

  async status(): Promise<SessionSummariesStatus> {
    await this.refreshAvailability(true)
    return {
      enabled: this.settingOn(),
      configured: this.configured,
      pausedUntil: this.utility.health().pausedUntil
    }
  }

  async list(): Promise<SessionSummariesListResult> {
    const status = await this.status()
    return {
      status,
      sessions: status.enabled
        ? this.panes.list().map(({ paneKey, agentType, providerSessionId, text, pending }) => ({
            paneKey,
            agentType,
            providerSessionId,
            text,
            pending
          }))
        : []
    }
  }

  async setEnabled(enabled: boolean): Promise<SessionSummariesStatus> {
    this.options.store.updateSettings({ sessionSummariesEnabled: enabled })
    return await this.status()
  }

  private settingOn(): boolean {
    return this.options.store.getSettings().sessionSummariesEnabled !== false
  }

  private decorate(session: LiveSession): LiveSession {
    return this.settingOn() && this.live ? this.live.decorate(session) : session
  }

  private isAvailable(): boolean {
    if (Date.now() - this.configuredCheckedAt > CONFIGURED_RECHECK_MS) {
      // A config file dropped in later is found without a restart.
      void this.refreshAvailability(true)
    }
    return this.settingOn() && this.configured && this.utility.health().pausedUntil === null
  }

  private async refreshAvailability(recheckConfigured: boolean): Promise<void> {
    if (recheckConfigured) {
      this.configuredCheckedAt = Date.now()
      this.configured = await this.utility.isConfigured().catch(() => false)
    }
    const available =
      this.settingOn() && this.configured && this.utility.health().pausedUntil === null
    const cameBack = available && !this.available
    this.available = available
    if (cameBack) {
      this.summarizer.retryFailed()
    }
  }

  /** Coalesced and deferred: a change often lands while the registry is mid-publish. */
  private republishSoon(): void {
    if (this.republishQueued) {
      return
    }
    this.republishQueued = true
    queueMicrotask(() => {
      this.republishQueued = false
      this.options.onPaneSummaryChanged?.()
      this.options.liveSessions?.registry.republish()
    })
  }
}

export function installSessionSummaries(
  options: SessionSummariesInstallOptions
): SessionSummariesHost {
  getSessionSummariesHost()?.dispose()
  const host = new SessionSummariesHost(options)
  setSessionSummariesHost(host)
  host.start()
  return host
}
