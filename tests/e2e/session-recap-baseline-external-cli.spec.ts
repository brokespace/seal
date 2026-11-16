// Baseline of the session recap for agent CLI sessions started outside Seal: recorded real-model replies, the real scheduler, and what a correct recap would show.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { evaluateRecapCheck } from '../../src/main/session-recap/scenarios/recap-scenario-checks.test-fixture'
import {
  recapScenarioSchema,
  type RecapScenarioCheck,
  type RecapScenarioStep
} from '../../src/main/session-recap/scenarios/recap-scenario-schema.test-fixture'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'
import {
  RECAP_SECTIONS,
  type SessionRecapView
} from '../../src/shared/session-recap/session-recap-types'
import {
  seedExternalClaudeSession,
  type ExternalClaudeSession
} from './helpers/external-claude-session'
import { finishEdit, finishToolCall, sayMidTurn } from './helpers/external-claude-turn-records'
import { seedExternalCodexSession } from './helpers/external-codex-session'
import {
  readLiveSession,
  readSessionRecap,
  rescanLiveSessions,
  waitForLiveSession
} from './helpers/live-session-registry'
import {
  NEXT_AUTOMATIC_PASS_MS,
  RECAP_BASELINE_ENABLED,
  openRecapPanel,
  readRecapPanelLists,
  readRecapScenario,
  recapEvidencePath,
  recordedRecapCassette,
  recordedRecapRepliesWithRepairs,
  saveRecapEvidence,
  waitForRecapPass,
  type RecapPanelLists
} from './helpers/recap-baseline'
import {
  expect,
  readUtilityRequests,
  SUPPORTED,
  test,
  useScriptedSessionServices,
  writeSessionServicesScript,
  type SessionServicesStub
} from './helpers/session-services-stub'

type Checkpoint = {
  label: string
  evidence: string
  view: SessionRecapView
  panel: RecapPanelLists | null
  /** What the open panel says about the recap's state above it ("The session has moved on..."). */
  panelNote: string | null
  results: { why: string; ok: boolean; actual: string }[]
}
type Scenario = {
  id: string
  /** The conversation between two points where the scenario waits, looks or checks. */
  runs: RecapScenarioStep[][]
  checks: Map<string, RecapScenarioCheck[]>
}

function loadScenario(id: string): Scenario {
  const { steps } = recapScenarioSchema.parse(readRecapScenario(id))
  const runs: RecapScenarioStep[][] = []
  const checks = new Map<string, RecapScenarioCheck[]>()
  let run: RecapScenarioStep[] | null = null
  for (const step of steps) {
    if ('check' in step) {
      checks.set(step.label, step.check)
    }
    if ('check' in step || 'advance' in step || 'open' in step || 'refresh' in step) {
      run = null
      continue
    }
    if (!run) {
      run = []
      runs.push(run)
    }
    run.push(step)
  }
  return { id, runs, checks }
}

/** Writes one run of a scenario into a Claude session's transcript, as Claude Code would. */
async function playSteps(
  page: Page,
  session: ExternalClaudeSession,
  steps: readonly RecapScenarioStep[]
): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if ('user' in step) {
      session.submitPrompt(step.user)
      await waitForLiveSession(page, session.sessionId, (found) => found.status === 'working')
    } else if ('agent' in step) {
      const next = steps[index + 1]
      if (next && 'status' in next) {
        session.finishTurn(step.agent)
      } else {
        sayMidTurn(session, step.agent)
      }
    } else if ('tool' in step) {
      finishToolCall(session, step.tool.name, step.tool.input, step.tool.output ?? '')
    } else if ('edit' in step) {
      finishEdit(session, step.edit)
    } else if ('question' in step) {
      session.askQuestion(step.question.text)
    } else if ('status' in step && step.status === 'done') {
      session.stop()
    }
  }
}

function waitForSessionRecapPass(
  page: Page,
  sessionId: string,
  after: number,
  timeout: number
): Promise<SessionRecapView> {
  return waitForRecapPass(
    () => readSessionRecap(page, sessionId),
    after,
    timeout,
    () => rescanLiveSessions(page)
  )
}

/** The panel draws the recap the host holds: every item under its section, and no section without items. */
async function expectPanelShows(panel: Locator, view: SessionRecapView): Promise<void> {
  for (const section of RECAP_SECTIONS) {
    const shown = panel.locator(`[data-recap-section="${section}"]`)
    const items = view.recap?.[section] ?? []
    if (items.length === 0) {
      await expect(shown).toHaveCount(0)
    }
    for (const item of items) {
      await expect(shown).toContainText(item.text)
    }
  }
}

async function readPanelNote(panel: Locator): Promise<string | null> {
  const note = panel.locator('[data-recap-note]')
  return (await note.count()) > 0 ? note.innerText() : null
}

/** One scenario's run: the evidence at each point, then what a correct recap would have shown there. */
function recapBaseline(
  page: Page,
  testInfo: TestInfo,
  stub: SessionServicesStub,
  scenario: Scenario,
  surface: string,
  sessionId: string
) {
  const checkpoints: Checkpoint[] = []
  const notes: Record<string, unknown> = {}
  const entries = recordedRecapCassette(scenario.id)
  const requests = () =>
    readUtilityRequests(stub, 'recap').map(({ prompt, reply, failure }) => {
      const answeredBy = entries.filter((entry) => entry.reply === reply)
      return {
        recapSoFar: prompt.slice(
          prompt.lastIndexOf('<recap>\n') + '<recap>\n'.length,
          prompt.lastIndexOf('\n</recap>')
        ),
        newMessages: prompt.slice(prompt.lastIndexOf('<new_messages>')),
        repair: prompt.includes('Your earlier reply:'),
        reply,
        failure,
        recorded: answeredBy.length > 0,
        /** The recap so far and the new messages are, to the character, what the pipeline run sent. */
        sameRequestAsPipeline: answeredBy.some((entry) =>
          entry.messages
            .filter((message) => message.role === 'user')
            .every((message) => prompt.includes(message.content))
        )
      }
    })
  return {
    notes,
    requests,
    /**
     * Saves `<evidence>.png` and `<evidence>.json`, then judges the scenario's checks under `label`.
     * With `panel`, the open recap panel has to show the same recap first.
     */
    async checkpoint(label: string, evidence: string, panel?: Locator): Promise<SessionRecapView> {
      if (panel) {
        await expectPanelShows(panel, await readSessionRecap(page, sessionId))
      }
      const view = await saveRecapEvidence(page, testInfo, evidence, sessionId, stub)
      const context = { view, requests: requests().length, lastModel: null }
      checkpoints.push({
        label,
        evidence,
        view,
        panel: panel ? await readRecapPanelLists(panel) : null,
        panelNote: panel ? await readPanelNote(panel) : null,
        results: (scenario.checks.get(label) ?? []).map((check) => ({
          why: check.why,
          ...evaluateRecapCheck(check, context)
        }))
      })
      return view
    },
    /** Writes `baseline.json`; its presence says the scenario was driven to its end. */
    finish(): { wrong: string[]; unrecorded: string[] } {
      const made = requests()
      const wrong = checkpoints.flatMap((checkpoint) =>
        checkpoint.results
          .filter((result) => !result.ok)
          .map((result) => `${checkpoint.label}: ${result.why} (was: ${result.actual})`)
      )
      const unrecorded = made.filter((request) => !request.recorded).map((r) => r.newMessages)
      writeFileSync(
        recapEvidencePath(testInfo, 'baseline.json'),
        `${JSON.stringify(
          { scenario: scenario.id, surface, wrong, unrecorded, notes, checkpoints, requests: made },
          null,
          2
        )}\n`
      )
      return { wrong, unrecorded }
    }
  }
}

function settledStatus(steps: readonly RecapScenarioStep[]): LiveSession['status'] {
  const step = steps.findLast((found) => 'status' in found)
  return step && 'status' in step ? step.status : 'your-turn'
}

async function waitForTurnEnd(
  page: Page,
  sessionId: string,
  steps: readonly RecapScenarioStep[]
): Promise<void> {
  const status = settledStatus(steps)
  await waitForLiveSession(page, sessionId, (found) => found.status === status, {
    message: `the session did not settle on ${status}`
  })
}

test.describe('session recap baseline: agent CLI sessions started outside Seal', () => {
  test('addressed-later-user-looks-at-once on an external Claude CLI session: the recap opened right after the turn that wrote the docs shows them done', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(
      true,
      'the recap opened seconds after turn 2 is the stale one from turn 1, and the docs are never listed as not addressed nor as done'
    )
    // Two turns with the scheduler's 4 minutes between their automatic passes.
    test.setTimeout(540_000)
    const scenario = loadScenario('addressed-later-user-looks-at-once')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalClaudeSession(electronApp)
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Claude CLI',
      session.sessionId
    )
    try {
      await playSteps(orcaPage, session, scenario.runs[0])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[0])
      await waitForSessionRecapPass(orcaPage, session.sessionId, 0, 90_000)
      const first = await baseline.checkpoint('after turn 1', 'after-turn-1')

      await playSteps(orcaPage, session, scenario.runs[1])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[1])
      const openedAt = Date.now()
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      const opened = await baseline.checkpoint(
        'the user opens the recap right after turn 2',
        'right-after-turn-2',
        panel
      )
      baseline.notes.secondsFromFirstPassToOpening = Math.round(
        (openedAt - first.recap!.updatedAt) / 1000
      )

      const next = await waitForSessionRecapPass(
        orcaPage,
        session.sessionId,
        opened.recap!.updatedAt,
        NEXT_AUTOMATIC_PASS_MS
      )
      baseline.notes.secondsFromOpeningToNextPass = Math.round(
        (next.recap!.updatedAt - openedAt) / 1000
      )
      await baseline.checkpoint('four minutes later', 'after-next-automatic-pass', panel)
    } finally {
      session.stop()
    }
    const { wrong, unrecorded } = baseline.finish()
    expect(unrecorded, 'recap requests no recorded reply answered').toEqual([])
    expect(wrong, 'what a correct recap would show').toEqual([])
  })

  test('session-ends-right-after-its-turn on an external Claude CLI session: a session whose process exits with its turn still gets a recap', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(true, 'a session that ends before the 2.5 s settle delay never gets a recap')
    // One turn, then the minute the scenario waits after the process is gone.
    test.setTimeout(300_000)
    const scenario = loadScenario('session-ends-right-after-its-turn')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalClaudeSession(electronApp)
    // A lone `claude` process without a transcript (another test's stand-in in `ps`) is handed the
    // ended session's transcript and read as that session, alive. Two such processes never are.
    const bystanders = [
      await seedExternalClaudeSession(electronApp, {
        cwd: path.join(path.dirname(session.cwd), 'idle-a')
      }),
      await seedExternalClaudeSession(electronApp, {
        cwd: path.join(path.dirname(session.cwd), 'idle-b')
      })
    ]
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Claude CLI',
      session.sessionId
    )
    try {
      await playSteps(orcaPage, session, scenario.runs[0])
      const endedAt = Date.now()
      let listed: LiveSession | null = null
      await expect
        .poll(
          async () => {
            await rescanLiveSessions(orcaPage)
            listed = await readLiveSession(orcaPage, session.sessionId)
            return listed === null || !listed.alive
          },
          { timeout: 60_000, message: 'the registry still lists the ended session as alive' }
        )
        .toBe(true)
      await expect
        .poll(
          async () =>
            (await readSessionRecap(orcaPage, session.sessionId)).recap !== null ||
            Date.now() - endedAt >= 60_000,
          { timeout: 90_000, intervals: [5_000] }
        )
        .toBe(true)
      listed = await readLiveSession(orcaPage, session.sessionId)
      baseline.notes.registryAMinuteAfter = listed
        ? { status: listed.status, alive: listed.alive, recap: listed.recap ?? null }
        : null
      baseline.notes.recapRequestsBeforeOpening = baseline.requests().length
      await baseline.checkpoint(
        'five minutes after the session ended',
        'a-minute-after-the-session-ended'
      )

      const row = orcaPage.locator(
        `[data-testid="active-agents"] [data-live-session-row="${session.sessionId}"]`
      )
      const finished = orcaPage.locator(
        '[data-testid="active-agents"] [data-active-agents-finished]'
      )
      baseline.notes.rowShownBeforeUnfolding = await row.isVisible()
      await finished.locator('button[aria-expanded="false"]').click()
      await expect(row).toBeVisible()
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      const openedAt = Date.now()
      await expect
        .poll(
          async () => {
            const view = await readSessionRecap(orcaPage, session.sessionId)
            return (
              (view.recap !== null && view.state === 'ready') || Date.now() - openedAt >= 30_000
            )
          },
          { timeout: 60_000, intervals: [1_000] }
        )
        .toBe(true)
      // No scenario label: the pipeline run never opened the session, so nothing is judged here.
      await baseline.checkpoint(
        'the user unfolds Recently finished and opens the ended session',
        'after-opening-it',
        panel
      )
      baseline.notes.recapRequestsAfterOpening = baseline.requests().length
    } finally {
      session.stop()
      bystanders.forEach((bystander) => bystander.stop())
    }
    const { wrong } = baseline.finish()
    expect(baseline.notes.recapRequestsBeforeOpening, 'recap requests before anyone looked').toBe(0)
    expect(wrong, 'what a correct recap would show').toEqual([])
  })

  test('partly-addressed-then-finished on an external Claude CLI session: once turn 2 finishes the work nothing is listed as asked but not addressed', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(
      true,
      'after turn 1 /customers is not listed as not addressed, and after turn 2 the recap gains a stale "Leave /customers for follow-up" entry there'
    )
    // Two turns with the scheduler's 4 minutes between their automatic passes.
    test.setTimeout(540_000)
    const scenario = loadScenario('partly-addressed-then-finished')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalClaudeSession(electronApp)
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Claude CLI',
      session.sessionId
    )
    try {
      await playSteps(orcaPage, session, scenario.runs[0])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[0])
      await waitForSessionRecapPass(orcaPage, session.sessionId, 0, 90_000)
      const first = await baseline.checkpoint('after turn 1', 'after-turn-1')

      await playSteps(orcaPage, session, scenario.runs[1])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[1])
      const next = await waitForSessionRecapPass(
        orcaPage,
        session.sessionId,
        first.recap!.updatedAt,
        NEXT_AUTOMATIC_PASS_MS
      )
      baseline.notes.secondsBetweenPasses = Math.round(
        (next.recap!.updatedAt - first.recap!.updatedAt) / 1000
      )
      // The recap is up to date, so this look starts no pass.
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      await baseline.checkpoint('after turn 2', 'after-turn-2', panel)
      const ignored = panel.locator('[data-recap-section="ignored"]')
      if ((await ignored.count()) > 0) {
        await ignored.screenshot({ path: recapEvidencePath(testInfo, 'after-turn-2-ignored.png') })
      }
    } finally {
      session.stop()
    }
    const { wrong, unrecorded } = baseline.finish()
    expect(unrecorded, 'recap requests no recorded reply answered').toEqual([])
    expect(wrong, 'what a correct recap would show').toEqual([])
  })

  test('mid-turn-refresh on an external Claude CLI session: Refresh mid-turn shows the work in progress, and the turn end brings the recap up to date', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(
      true,
      'mid-turn the work under way is not listed, and after the turn ends the recap stays stale until the automatic pass 4 minutes after the Refresh'
    )
    // One turn, then the scheduler's 4 minutes from the Refresh to the next automatic pass.
    test.setTimeout(540_000)
    const scenario = loadScenario('mid-turn-refresh')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalClaudeSession(electronApp)
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Claude CLI',
      session.sessionId
    )
    try {
      await playSteps(orcaPage, session, scenario.runs[0])
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      const refresh = panel.locator('[data-recap-refresh]')
      // Opening a session that has no recap yet already starts a pass; Refresh is disabled until it ends.
      await expect
        .poll(() => baseline.requests().length, { timeout: 60_000 })
        .toBeGreaterThanOrEqual(1)
      await expect(refresh).toBeEnabled({ timeout: 60_000 })
      baseline.notes.recapRequestsBeforeRefresh = baseline.requests().length
      await baseline.checkpoint('on opening mid-turn', 'mid-turn-on-opening', panel)

      await refresh.click()
      await expect
        .poll(() => baseline.requests().length, { timeout: 60_000 })
        .toBeGreaterThan(Number(baseline.notes.recapRequestsBeforeRefresh))
      await expect(refresh).toBeEnabled({ timeout: 60_000 })
      baseline.notes.recapRequestsAfterRefresh = baseline.requests().length
      baseline.notes.statusAtRefresh = (await readLiveSession(orcaPage, session.sessionId))?.status
      const midTurn = await baseline.checkpoint('mid-turn', 'mid-turn-after-refresh', panel)

      await playSteps(orcaPage, session, scenario.runs[1])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[1])
      await baseline.checkpoint('right after the turn ends', 'right-after-the-turn-ends', panel)

      const next = await waitForSessionRecapPass(
        orcaPage,
        session.sessionId,
        midTurn.recap!.updatedAt,
        NEXT_AUTOMATIC_PASS_MS
      )
      baseline.notes.secondsFromRefreshToNextPass = Math.round(
        (next.recap!.updatedAt - midTurn.recap!.updatedAt) / 1000
      )
      await baseline.checkpoint('four minutes later', 'after-next-automatic-pass', panel)
    } finally {
      session.stop()
    }
    const { wrong, unrecorded } = baseline.finish()
    expect(unrecorded, 'recap requests no recorded reply answered').toEqual([])
    expect(wrong, 'what a correct recap would show').toEqual([])
  })

  test('question-tool-waiting on an external Claude CLI session: a question asked through the question tool is listed as open', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(true, 'the question the agent waits on is not in the recap')
    // One turn, its registry scans and one recap pass.
    test.setTimeout(240_000)
    const scenario = loadScenario('question-tool-waiting')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalClaudeSession(electronApp)
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Claude CLI',
      session.sessionId
    )
    try {
      await playSteps(orcaPage, session, scenario.runs[0])
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[0])
      await waitForSessionRecapPass(orcaPage, session.sessionId, 0, 90_000)
      // The recap is up to date, so this look starts no pass.
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      await baseline.checkpoint('while the agent waits', 'while-the-agent-waits', panel)
    } finally {
      session.stop()
    }
    const { wrong, unrecorded } = baseline.finish()
    expect(unrecorded, 'recap requests no recorded reply answered').toEqual([])
    expect(wrong, 'what a correct recap would show').toEqual([])
  })

  test('declined-with-a-reason on an external Codex CLI session: a refused request is not listed as asked but not addressed', async ({
    orcaPage,
    electronApp,
    sessionServicesStub
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    test.fail(
      true,
      'the refused request is listed as asked but not addressed, and where it stands says nothing'
    )
    // One turn, its registry scans and one recap pass.
    test.setTimeout(240_000)
    const scenario = loadScenario('declined-with-a-reason')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recordedRecapRepliesWithRepairs(scenario.id)
    })
    const session = await seedExternalCodexSession(electronApp)
    const baseline = recapBaseline(
      orcaPage,
      testInfo,
      sessionServicesStub,
      scenario,
      'external Codex CLI',
      session.sessionId
    )
    try {
      for (const step of scenario.runs[0]) {
        if ('user' in step) {
          session.submitPrompt(step.user)
          await waitForLiveSession(
            orcaPage,
            session.sessionId,
            (found) => found.status === 'working'
          )
        } else if ('tool' in step) {
          session.runTool(step.tool.name, step.tool.input, step.tool.output ?? '')
        } else if ('agent' in step) {
          session.finishTurn(step.agent)
        }
      }
      await waitForTurnEnd(orcaPage, session.sessionId, scenario.runs[0])
      await waitForSessionRecapPass(orcaPage, session.sessionId, 0, 90_000)
      // The recap is up to date, so this look starts no pass.
      const panel = await openRecapPanel(orcaPage, session.sessionId)
      await baseline.checkpoint('after the turn', 'after-the-turn', panel)
    } finally {
      session.stop()
    }
    const { wrong, unrecorded } = baseline.finish()
    expect(unrecorded, 'recap requests no recorded reply answered').toEqual([])
    expect(wrong, 'what a correct recap would show').toEqual([])
  })
})
