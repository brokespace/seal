import { join } from 'node:path'
import type {
  AgentSessionSurface,
  LiveSession
} from '../../shared/live-sessions/live-session-types'
import type {
  SessionSummariesListResult,
  SessionSummariesStatus
} from '../../shared/session-summaries/session-summary-contracts'
import type { ReplyAskVerdict } from '../live-sessions/live-session-notifier'
import { liveSessionTranscripts } from '../live-sessions/transcripts/live-session-transcripts'
import { structuredChatJournal } from '../live-sessions/transcripts/journal-session-transcript'
import type { LiveSessionRecaps } from '../session-recap/live-session-recaps'
import { createLiveSessionRecaps } from '../session-recap/session-recap-install'
import {
  normalizeSessionSummaryModels,
  utilityModelChoiceFor,
  type SessionSummaryModels,
  type UtilityModelTask
} from '../../shared/utility-model/utility-model-selection'
import { getUtilityModelHost, type UtilityModelClient } from '../utility-model/utility-model-host'
import { renameCliSessionTab } from './cli-session-tab-title'
import { lastAssistantText } from './last-assistant-text'
import { LiveSessionSummaries } from './live-session-summaries'
import { createReplyAskClassifier, type ReplyAskClassifier } from './reply-ask-install'
import { sessionPaneWorkspaceId } from './session-pane-workspace'
import { SessionSummarizer } from './session-summarizer'
import { createSessionTitleWriteThrough } from './session-title-write-through'
import { unrefTimer } from './unref-timer'
import { SessionSummaryCache } from './session-summary-cache'
import { getSessionSummariesHost, setSessionSummariesHost } from './session-summaries-instance'
import type { SessionSummariesInstallOptions } from './session-summaries-install-options'

export type { SessionSummariesInstallOptions }

const CONFIGURED_RECHECK_MS = 60_000

/** Session status summaries on this host: what makes them, and what clients read. */
export class SessionSummariesHost {
  private readonly models: Record<UtilityModelTask, UtilityModelClient>
  private readonly summarizer: SessionSummarizer
  private readonly sessions: LiveSessionSummaries
  private readonly replyAsks: ReplyAskClassifier | null
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
    const transcripts = liveSessions ? liveSessionTranscripts(liveSessions) : null
    const summarizeRegistry = transcripts !== null && options.summarizeLive !== false
    this.sessions = new LiveSessionSummaries({
      summarizer: this.summarizer,
      readHookRow: (paneKey) => options.runtime.agentTransitions.latestRow(paneKey),
      lastAssistantText: async (sessionId) =>
        transcripts ? await lastAssistantText(transcripts.of(sessionId)) : null,
      chatLastAssistantText: async (chatSessionId) => {
        const journal = structuredChatJournal(chatSessionId, chatSessionId)
        return journal ? await lastAssistantText(journal) : null
      },
      summarizeRegistry,
      serverSummaries: options.serverSummaries,
      onChange: () => this.republishSoon(),
      setTimer: unrefTimer,
      log
    })
    this.replyAsks =
      liveSessions && transcripts && summarizeRegistry
        ? createReplyAskClassifier({
            liveSessions,
            transcripts,
            userDataPath: options.userDataPath,
            model: () => this.model('summaries'),
            enabled: () => this.isAvailable(),
            onChange: () => this.republishSoon(),
            log
          })
        : null
    this.recap =
      liveSessions && transcripts
        ? createLiveSessionRecaps({
            liveSessions,
            transcripts,
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
      runtime.agentTransitions.subscribe((change) => this.sessions.observePane(change)),
      // Deferred: health changes fire from inside the request that noticed them.
      this.models.summaries.subscribe(() =>
        queueMicrotask(() => void this.refreshAvailability(true))
      )
    )
    // Both hosts attach hook status before this starts; its panes were seeded with nobody listening.
    for (const seed of runtime.agentTransitions.trackedPaneSeeds()) {
      this.sessions.observePane(seed)
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
      const log = (message: string, error?: unknown) => console.warn(message, error ?? '')
      const titles = createSessionTitleWriteThrough({
        liveSessions,
        renameCliTab: (paneKey, title) => renameCliSessionTab(runtime, paneKey, title, log),
        log
      })
      liveSessions.registry.setDecorator((session) => this.decorate(session))
      this.releases.push(
        liveSessions.subscribe((event) => this.sessions.observe(event)),
        titles.dispose
      )
    }
    void this.refreshAvailability(true)
  }

  dispose(): void {
    for (const release of this.releases.splice(0)) {
      release()
    }
    this.options.liveSessions?.registry.setDecorator(null)
    this.sessions.dispose()
    this.replyAsks?.dispose()
    this.recap?.dispose()
    this.summarizer.dispose()
  }

  /** A pane agent's summary for clients reading agent rows; null while off or when it has none. */
  paneSummary(paneKey: string): string | null {
    return this.settingOn() ? (this.sessions.paneView(paneKey)?.text ?? null) : null
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
        ? this.sessions.list().map(({ paneKey, agentType, providerSessionId, text, pending }) => ({
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

  /** Whether a session's finished turn ended on a question; 'deciding' while its reply is read. */
  replyAsk(session: LiveSession): ReplyAskVerdict {
    return this.settingOn() && this.replyAsks ? this.replyAsks.verdict(session) : 'tells'
  }

  askedReply(sessionId: string): string | null {
    return this.replyAsks?.askedReply(sessionId) ?? null
  }

  paneWorkspaceId(surface: AgentSessionSurface): string | null {
    return sessionPaneWorkspaceId(this.options.runtime, surface)
  }

  private decorate(session: LiveSession): LiveSession {
    const on = this.settingOn()
    const settled = on && this.replyAsks ? this.replyAsks.decorate(session) : session
    const summarized = on ? this.sessions.decorate(settled) : settled
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
      this.replyAsks?.retryFailed()
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
