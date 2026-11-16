// Runs one scenario through the recap as the app wires it: the real transcript readers, engine, scheduler, store, budget and utility-model service. Only the clock and the model's HTTP endpoint are the scenario's.
import { copyFile, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { LiveSession } from '../../../shared/live-sessions/live-session-types'
import type { SessionRecapView } from '../../../shared/session-recap/session-recap-types'
import { runLocalScript } from '../../live-sessions/hosts/local-shell-script'
import { journalSessionTranscript } from '../../live-sessions/transcripts/journal-session-transcript'
import { LiveTranscriptStreams } from '../../live-sessions/transcripts/live-transcript-streams'
import { sessionTranscripts } from '../../live-sessions/transcripts/session-transcript'
import {
  createCloudflareWorkersAiProvider,
  type CloudflareAiCredentials
} from '../../utility-model/cloudflare-workers-ai-provider'
import { UtilityModelService } from '../../utility-model/utility-model-service'
import { LiveSessionRecaps } from '../live-session-recaps'
import { SessionRecapBudget } from '../session-recap-budget'
import { SessionRecapEngine } from '../session-recap-engine'
import { SessionRecapStore } from '../session-recap-store'
import { chatJournalScenario } from './recap-scenario-chat-journal.test-fixture'
import { evaluateRecapCheck, type RecapCheckResult } from './recap-scenario-checks.test-fixture'
import {
  claudeScenarioTranscript,
  type RecapScenarioConversation
} from './recap-scenario-claude-transcript.test-fixture'
import { codexScenarioTranscript } from './recap-scenario-codex-transcript.test-fixture'
import { RECAP_SCENARIO_MODELS, type RecapScenarioModel } from './recap-scenario-model.test-fixture'
import {
  recapScenarioSteps,
  type RecapScenario,
  type RecapScenarioSurface
} from './recap-scenario-schema.test-fixture'

export type RecapScenarioRun = {
  /** `<scenario>@<surface>`. */
  id: string
  scenario: RecapScenario
  surface: RecapScenarioSurface
  /** `pending` when a request had no recorded reply, so the scenario stopped short. */
  status: 'pass' | 'fail' | 'pending'
  checks: RecapCheckResult[]
  /** Every pass the scheduler started: its kind and how it ended. */
  passes: string[]
  requests: number
  view: SessionRecapView
}

const START = Date.UTC(2026, 10, 13, 10, 0, 0)
const STEP_MS = 2_000
const SESSION_IDS = ['7d0c1c0e-5a51-4f0a-9d0b-2a6f3c1e8b01', '7d0c1c0e-5a51-4f0a-9d0b-2a6f3c1e8b02']

type Timer = { run: () => void; at: number }

export async function runRecapScenario(
  scenario: RecapScenario,
  surface: RecapScenarioSurface,
  model: RecapScenarioModel,
  /** A real account, when the model's endpoint is the real one. */
  credentials: CloudflareAiCredentials = { accountId: 'scenario', apiToken: 'scenario' }
): Promise<RecapScenarioRun> {
  const folder = await mkdtemp(join(tmpdir(), 'seal-recap-scenario-'))
  const clock = { now: START }
  const timers: Timer[] = []
  const passes: string[] = []
  const checks: RecapCheckResult[] = []
  const provider = surface === 'codex-cli' ? 'codex' : 'claude'
  const remote = surface === 'claude-ssh'
  const hostId = remote ? 'ssh-build-box' : 'local'
  const journal = surface === 'chat-journal' ? chatJournalScenario() : null
  let transcriptPath = join(folder, 'session-1.jsonl')
  const fileConversation = (path: string, id: string): RecapScenarioConversation =>
    provider === 'codex' ? codexScenarioTranscript(path, id) : claudeScenarioTranscript(path, id)
  let conversation = journal?.conversation ?? fileConversation(transcriptPath, SESSION_IDS[0])
  let revision = 0
  let session: LiveSession = {
    id: `${hostId}:${provider}:${SESSION_IDS[0]}`,
    provider,
    providerSessionId: SESSION_IDS[0],
    machine: {
      hostId,
      label: hostId,
      kind: remote ? 'remote' : 'local',
      connection: remote ? 'ssh' : 'local'
    },
    origin: journal ? 'seal' : 'external',
    cwd: '/srv/shop',
    project: 'shop',
    title: null,
    status: 'idle',
    statusSource: 'transcript',
    statusDetail: null,
    lastActivityAt: START,
    startedAt: START,
    alive: true,
    pid: 4242,
    transcriptPath: journal ? null : transcriptPath,
    inputRoutes: [],
    permission: null,
    ...(journal ? { surface: { kind: 'chat', sessionId: 'chat-1', tabId: 'tab-1' } } : {})
  }
  const sessionOf = (id: string): LiveSession | null => (id === session.id ? session : null)

  // The SSH reader's own script, run in a local shell: the bounded base64 reads are the same.
  const streams = new LiveTranscriptStreams({
    get: sessionOf,
    host: () => ({ machine: session.machine, run: runLocalScript })
  })
  const transcripts = sessionTranscripts(sessionOf, {
    files: {
      page: (id, before, limit) => streams.page(id, before, limit),
      since: (id, cursor) => streams.since(id, cursor)
    },
    journal: (_chat, recordId) =>
      journal ? journalSessionTranscript(recordId, journal.read) : null
  })
  const utility = new UtilityModelService({
    backend: async () => ({
      provider: createCloudflareWorkersAiProvider(credentials, model.fetch),
      models: [RECAP_SCENARIO_MODELS.primary, RECAP_SCENARIO_MODELS.fallback]
    }),
    now: () => clock.now
  })

  // Mirrors `createLiveSessionRecaps` (session-recap-install.ts), with the scenario's clock and timers.
  const build = () => {
    const store = new SessionRecapStore(join(folder, 'session-recaps', 'recaps.json'))
    const budget = new SessionRecapBudget(
      join(folder, 'session-recaps', 'budget.json'),
      () => clock.now
    )
    const engine = new SessionRecapEngine({
      transcript: {
        page: (id, before, limit) => transcripts.of(id).page(before, limit),
        since: (id, cursor) => transcripts.of(id).since(cursor)
      },
      complete: (request, signal) => utility.complete(request, signal),
      store,
      budget,
      firstPrompt: (id) => {
        const found = sessionOf(id)
        return found && !found.titleNamed ? found.title : null
      },
      onChange: () => undefined,
      now: () => clock.now
    })
    const recaps = new LiveSessionRecaps({
      engine: {
        update: async (id, kind, rebuild, minProseChars) => {
          const outcome = await engine.update(id, kind, rebuild, minProseChars)
          passes.push(`${kind}${rebuild ? ' rebuild' : ''}: ${outcome}`)
          return outcome
        },
        isUpdating: (id) => engine.isUpdating(id),
        failure: (id) => engine.failure(id),
        forget: (id) => engine.forget(id)
      },
      store,
      enabled: () => true,
      pausedUntil: () => utility.health().pausedUntil,
      session: sessionOf,
      readable: (found) => transcripts.has(found),
      eager: scenario.lazy !== true,
      setTimer: (run, delayMs) => {
        const timer = { run, at: clock.now + delayMs }
        timers.push(timer)
        return {
          cancel: () => void (timers.includes(timer) && timers.splice(timers.indexOf(timer), 1))
        }
      },
      now: () => clock.now
    })
    return { store, budget, engine, recaps }
  }
  let host = build()
  await Promise.all([host.store.load(), host.budget.load()])
  // As the summaries host does: sessions that stopped while the provider was held are due when it is back.
  let running = true
  utility.subscribe(() =>
    queueMicrotask(() => {
      const now = utility.health().pausedUntil === null
      if (now && !running) {
        host.recaps.resume()
      }
      running = now
    })
  )

  const settle = async (): Promise<void> => {
    do {
      await new Promise((resolve) => setImmediate(resolve))
    } while (host.engine.isUpdating(session.id))
    await new Promise((resolve) => setImmediate(resolve))
  }
  const publish = (): void => host.recaps.observe({ type: 'upsert', revision: ++revision, session })
  const setStatus = (status: LiveSession['status']): void => {
    session = { ...session, status, lastActivityAt: clock.now, alive: status !== 'done' }
    journal?.setWorking(status === 'working')
    publish()
  }
  const advance = async (ms: number): Promise<void> => {
    const until = clock.now + ms
    for (;;) {
      const due = timers.filter((timer) => timer.at <= until).sort((a, b) => a.at - b.at)[0]
      if (!due) {
        break
      }
      timers.splice(timers.indexOf(due), 1)
      clock.now = Math.max(clock.now, due.at)
      due.run()
      await settle()
    }
    clock.now = until
  }

  for (const step of recapScenarioSteps(scenario)) {
    if (model.pending.length > 0) {
      break
    }
    if ('check' in step) {
      const view = host.recaps.view(session.id, false)
      for (const check of step.check) {
        const context = {
          view,
          requests: model.answeredBy.length,
          lastModel: model.answeredBy.at(-1) ?? null
        }
        checks.push({ label: step.label, check, ...evaluateRecapCheck(check, context) })
      }
      continue
    }
    clock.now += STEP_MS
    const wrote = await conversation.write(step, clock.now)
    if ('user' in step && session.title === null) {
      session = { ...session, title: step.user.split('\n')[0].slice(0, 80) }
    }
    if ('status' in step) {
      setStatus(step.status)
    } else if ('user' in step && session.status !== 'working') {
      setStatus('working')
    } else if (wrote && session.status === 'working') {
      // The registry's next scan sees the new record.
      session = { ...session, lastActivityAt: clock.now }
      publish()
    } else if ('advance' in step) {
      await advance(step.advance)
    } else if ('open' in step) {
      host.recaps.view(session.id, true)
      await settle()
    } else if ('refresh' in step) {
      await host.recaps.refresh(session.id)
    } else if ('mark' in step) {
      const recap = host.recaps.view(session.id, false).recap
      const pattern = new RegExp(step.mark.item, 'i')
      const item = [
        ...(recap?.questions ?? []),
        ...(recap?.actions ?? []),
        ...(recap?.ignored ?? [])
      ].find((found) => pattern.test(found.text))
      if (item) {
        host.recaps.mark(session.id, item.id, step.mark.as)
      }
    } else if ('fault' in step) {
      model.fail(step.fault.kind, RECAP_SCENARIO_MODELS[step.fault.model], step.fault.times)
    } else if ('restart' in step) {
      await host.store.flush()
      host.recaps.dispose()
      host.engine.dispose()
      timers.length = 0
      host = build()
      await Promise.all([host.store.load(), host.budget.load()])
      publish()
    } else if ('resume' in step) {
      const before = session.id
      if (!journal) {
        // `--resume` carries the conversation into a new file under a new session id.
        const next = join(folder, 'session-2.jsonl')
        await copyFile(transcriptPath, next)
        await writeFile(
          next,
          (await readFile(next, 'utf8')).replaceAll(SESSION_IDS[0], SESSION_IDS[1])
        )
        transcriptPath = next
        conversation = fileConversation(next, SESSION_IDS[1])
      }
      session = {
        ...session,
        id: `${hostId}:${provider}:${SESSION_IDS[1]}`,
        providerSessionId: SESSION_IDS[1],
        transcriptPath: journal ? null : transcriptPath,
        continues: [before]
      }
      host.recaps.observe({
        type: 'remove',
        revision: ++revision,
        sessionId: before,
        replacedBy: session.id
      })
      publish()
    }
    await settle()
  }

  const view = host.recaps.view(session.id, false)
  await host.store.flush()
  host.recaps.dispose()
  host.engine.dispose()
  const failed = checks.some((check) => !check.ok)
  return {
    id: `${scenario.id}@${surface}`,
    scenario,
    surface,
    status: model.pending.length > 0 ? 'pending' : failed ? 'fail' : 'pass',
    checks,
    passes,
    requests: model.answeredBy.length,
    view
  }
}
