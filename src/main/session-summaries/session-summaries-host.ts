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
import type { LiveSessionRecaps } from '../session-recap/live-session-recaps'
import { createLiveSessionRecaps } from '../session-recap/session-recap-install'
import {
  normalizeSessionSummaryModels,
  utilityModelChoiceFor,
  type SessionSummaryModels,
  type UtilityModelTask
} from '../../shared/utility-model/utility-model-selection'
import { getUtilityModelHost, type UtilityModelClient } from '../utility-model/utility-model-host'
import type { UtilityModelHostContext } from '../utility-model/utility-model-provider-sources'
import { lastAssistantText } from './last-assistant-text'
import { LiveSessionSummaries, type LiveSessionSummariesDeps } from './live-session-summaries'
import { PaneSessionSummaries } from './pane-session-summaries'
import { SessionSummarizer } from './session-summarizer'
import { SessionSummaryCache } from './session-summary-cache'
import { getSessionSummariesHost, setSessionSummariesHost } from './session-summaries-instance'

type SummarySettingsStore = {
  getSettings(): SessionSummarySettings & ReturnType<UtilityModelHostContext['settings']>
  updateSettings(updates: SessionSummarySettings): unknown
  onSettingsChanged(listener: (updates: Partial<SessionSummarySettings>) => void): unknown
}

type SummaryRuntime = {
  agentTransitions: {
    subscribe(listener: (change: AgentPaneChange) => void): () => void
    latestRow(paneKey: string): AgentStatusIpcPayload | null
    trackedPaneSeeds(): AgentPaneChange[]
  }
  /** The accounts agent CLIs run on; without it only providers with a saved key can be used. */
  getCommitMessageAgentEnvironmentResolvers?: UtilityModelHostContext['agentEnvironment']
}

export type SessionSummariesInstallOptions = {
  runtime: SummaryRuntime
  store: SummarySettingsStore
  userDataPath: string
  /** This host's session registry: its sessions get recaps, and status summaries unless `summarizeLive` is off. */
  liveSessions?: LiveSessionService | null
  /** False on a headless server, whose registry sessions the desktop that sees them summarizes. */
  summarizeLive?: boolean
  /** Recap every stopped session (the desktop), or only those opened from a client of this host. */
  recapEagerly?: boolean
  serverSummaries?: LiveSessionSummariesDeps['serverSummaries']
  /** A pane's summary changed: clients reading agent rows should read again. */
  onPaneSummaryChanged?: () => void
  /** One model for both summaries and recaps, in place of the providers Settings chose. */
  utilityModel?: UtilityModelClient
}

const CONFIGURED_RECHECK_MS = 60_000

function unrefTimer(run: () => void, delayMs: number): { cancel: () => void } {
  const timer = setTimeout(run, delayMs)
  timer.unref?.()
  return { cancel: () => clearTimeout(timer) }
}

/** Session status summaries on this host: what makes them, and what clients read. */
export class SessionSummariesHost {
  private readonly models: Record<UtilityModelTask, UtilityModelClient>
  private readonly summarizer: SessionSummarizer
  private readonly panes: PaneSessionSummaries
  private readonly live: LiveSessionSummaries | null
  private readonly recap: { recaps: LiveSessionRecaps; dispose: () => void } | null
  private readonly releases: (() => void)[] = []
  private readonly configured: Record<UtilityModelTask, boolean> = {
    summaries: false,
    recaps: false
  }
  private configuredCheckedAt = 0
  private available = false
  private recapReady = false
  private republishQueued = false

  constructor(private readonly options: SessionSummariesInstallOptions) {
    const log = (message: string, error?: unknown) => console.warn(message, error ?? '')
    const { liveSessions } = options
    this.models = {
      summaries: options.utilityModel ?? this.chosenModel('summaries'),
      recaps: options.utilityModel ?? this.chosenModel('recaps')
    }
    const cache = new SessionSummaryCache(
      join(options.userDataPath, 'session-summaries', 'cache.json'),
      log
    )
    void cache.load()
    this.summarizer = new SessionSummarizer({
      complete: async (request, signal) =>
        (await this.models.summaries.complete(request, signal)).text,
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
    this.live =
      liveSessions && options.summarizeLive !== false
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
    this.recap = liveSessions
      ? createLiveSessionRecaps({
          liveSessions,
          utility: this.models.recaps,
          userDataPath: options.userDataPath,
          enabled: () => this.recapOn() && this.isConfigured('recaps'),
          eager: options.recapEagerly !== false,
          onChange: () => this.republishSoon(),
          setTimer: unrefTimer,
          log
        })
      : null
  }

  /**
   * The utility model a chore runs on, as Settings chose it. Other features on this host (a status
   * classifier, say) call this instead of picking a provider of their own.
   */
  model(task: UtilityModelTask = 'summaries'): UtilityModelClient {
    return this.models[task]
  }

  /** Session recaps on this host; null where there is no session registry. */
  get recaps(): LiveSessionRecaps | null {
    return this.recap?.recaps ?? null
  }

  start(): void {
    const { runtime, store, liveSessions } = this.options
    this.releases.push(
      runtime.agentTransitions.subscribe((change) => this.panes.observe(change)),
      // Deferred: health changes fire from inside the request that noticed them.
      this.models.summaries.subscribe(() =>
        queueMicrotask(() => void this.refreshAvailability(true))
      )
    )
    // Both hosts attach hook status before this starts; its panes were seeded with nobody listening.
    for (const seed of runtime.agentTransitions.trackedPaneSeeds()) {
      this.panes.observe(seed)
    }
    store.onSettingsChanged((updates) => {
      const modelsChanged = 'sessionSummaryModels' in updates
      if (
        modelsChanged ||
        'sessionSummariesEnabled' in updates ||
        'sessionRecapEnabled' in updates
      ) {
        void this.refreshAvailability(modelsChanged)
        this.republishSoon()
      }
    })
    if (liveSessions) {
      const live = this.live
      liveSessions.registry.setDecorator((session) => this.decorate(session))
      if (live) {
        this.releases.push(liveSessions.subscribe((event) => live.observe(event)))
      }
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
    this.recap?.dispose()
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
      recapEnabled: this.recapOn(),
      configured: this.configured.summaries,
      pausedUntil: this.models.summaries.health().pausedUntil,
      models: this.selection(),
      recapConfigured: this.configured.recaps,
      recapPausedUntil: this.models.recaps.health().pausedUntil
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

  async setRecapEnabled(enabled: boolean): Promise<SessionSummariesStatus> {
    this.options.store.updateSettings({ sessionRecapEnabled: enabled })
    return await this.status()
  }

  async setModels(models: SessionSummaryModels): Promise<SessionSummariesStatus> {
    this.options.store.updateSettings({ sessionSummaryModels: models })
    return await this.status()
  }

  private selection(): SessionSummaryModels {
    return normalizeSessionSummaryModels(this.options.store.getSettings().sessionSummaryModels)
  }

  private chosenModel(task: UtilityModelTask): UtilityModelClient {
    return getUtilityModelHost().client(() => utilityModelChoiceFor(this.selection(), task))
  }

  private recapOn(): boolean {
    return this.options.store.getSettings().sessionRecapEnabled !== false
  }

  private settingOn(): boolean {
    return this.options.store.getSettings().sessionSummariesEnabled !== false
  }

  private decorate(session: LiveSession): LiveSession {
    const summarized = this.settingOn() && this.live ? this.live.decorate(session) : session
    return this.recap ? this.recap.recaps.decorate(summarized) : summarized
  }

  private isConfigured(task: UtilityModelTask): boolean {
    if (Date.now() - this.configuredCheckedAt > CONFIGURED_RECHECK_MS) {
      // A config file dropped in later is found without a restart.
      void this.refreshAvailability(true)
    }
    return this.configured[task]
  }

  private running(task: UtilityModelTask): boolean {
    return this.configured[task] && this.models[task].health().pausedUntil === null
  }

  private isAvailable(): boolean {
    return this.settingOn() && this.isConfigured('summaries') && this.running('summaries')
  }

  private async refreshAvailability(recheckConfigured: boolean): Promise<void> {
    if (recheckConfigured) {
      this.configuredCheckedAt = Date.now()
      const [summaries, recaps] = await Promise.all(
        (['summaries', 'recaps'] as const).map((task) =>
          this.models[task].isConfigured().catch(() => false)
        )
      )
      this.configured.summaries = summaries
      this.configured.recaps = recaps
    }
    const available = this.settingOn() && this.running('summaries')
    const cameBack = available && !this.available
    this.available = available
    if (cameBack) {
      this.summarizer.retryFailed()
    }
    // Recaps run with summaries switched off, so they watch the provider on their own terms.
    const recapReady = this.running('recaps')
    if (recapReady && !this.recapReady) {
      this.recap?.recaps.resume()
    }
    this.recapReady = recapReady
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
  getUtilityModelHost().connect({
    agentEnvironment: () => options.runtime.getCommitMessageAgentEnvironmentResolvers?.(),
    settings: () => options.store.getSettings()
  })
  const host = new SessionSummariesHost(options)
  setSessionSummariesHost(host)
  host.start()
  return host
}
