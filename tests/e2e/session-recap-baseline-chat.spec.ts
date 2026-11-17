// Baseline of the session recap for in-app chats: recorded real-model replies, the real scheduler, and what a correct recap would show.
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import type { SessionRecapView } from '../../src/shared/session-recap/session-recap-types'
import { readSessionRecap, rescanLiveSessions } from './helpers/live-session-registry'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import {
  captureRecapCheckpoint,
  failedRecapChecks,
  NEXT_AUTOMATIC_PASS_MS,
  openRecapPanel,
  readRecapScenarioTurns,
  RECAP_BASELINE_ENABLED,
  recapPanelMismatches,
  recordedRecapReplies,
  recordedRecapRepliesWithRepairs,
  saveRecapEvidence,
  saveRecapEvidenceJson,
  unrecordedRecapRequests,
  waitForRecapPass,
  type RecapCheckpoint
} from './helpers/recap-baseline'
import {
  expect,
  readStubChatLiveSession,
  readUtilityRequests,
  sendStubChatPrompt,
  startStubChat,
  SUPPORTED,
  test,
  useScriptedSessionServices,
  writeSessionServicesScript,
  type SessionServicesStub,
  type StubChat
} from './helpers/session-services-stub'
import { waitForSessionReady } from './helpers/store'

/** The row's status sentence is another feature's; scripted so no screenshot reads as a recap of something else. */
const ROW_STATUS_LINE = 'Scripted status line, not part of the recap.'

type Turn = { user: string; agent: string }

/** Later turns first: the stub answers with the first match, whatever else the frame carries. */
function chatScript(turns: readonly Turn[]): { replies: { match: string; reply: string }[] } {
  return { replies: turns.map((turn) => ({ match: turn.user, reply: turn.agent })).toReversed() }
}

async function runChatTurn(page: Page, chat: StubChat, turn: Turn): Promise<void> {
  // Back from the session's recap to the workspace the chat tab lives in.
  await page.locator(`[role="option"][data-worktree-id="${chat.worktreeId}"]`).click()
  await chat.tab.click()
  await sendStubChatPrompt(chat, turn.user)
  await expect(chat.root).toContainText(turn.agent, { timeout: 30_000 })
}

async function chatLiveSessionId(page: Page, chat: StubChat): Promise<string> {
  let sessionId = ''
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        sessionId = (await readStubChatLiveSession(page, chat))?.id ?? ''
        return sessionId
      },
      { timeout: 60_000, message: 'the registry lists no session for the chat' }
    )
    .not.toBe('')
  return sessionId
}

function waitForChatRecapPass(
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

/** One scenario in a chat on the scripted services, with a checkpoint after each turn's pass; returns what a correct recap lacks. */
async function runChatScenario(
  page: Page,
  testInfo: TestInfo,
  stub: SessionServicesStub,
  scenarioId: string,
  chatTitle: string
): Promise<{ problems: string[]; unrecorded: string[] }> {
  const { turns, checks } = readRecapScenarioTurns(scenarioId)
  const recorded = recordedRecapReplies(scenarioId)
  writeSessionServicesScript(stub, {
    recapReplies: recorded,
    chatTitle,
    summary: ROW_STATUS_LINE,
    chat: chatScript(turns)
  })

  const chat = await startStubChat(page, stub)
  const checkpoints: RecapCheckpoint[] = []
  let sessionId = ''
  let lastPassAt = 0
  for (const [index, turn] of turns.entries()) {
    await runChatTurn(page, chat, turn)
    sessionId ||= await chatLiveSessionId(page, chat)
    const view = await waitForChatRecapPass(
      page,
      sessionId,
      lastPassAt,
      index === 0 ? 60_000 : NEXT_AUTOMATIC_PASS_MS
    )
    lastPassAt = view.recap?.updatedAt ?? lastPassAt
    checkpoints.push(
      await captureRecapCheckpoint(
        page,
        testInfo,
        stub,
        sessionId,
        `after-turn-${index + 1}`,
        checks[index].label
      )
    )
  }
  return {
    problems: [...recapPanelMismatches(checkpoints), ...failedRecapChecks(checkpoints, checks)],
    unrecorded: unrecordedRecapRequests(readUtilityRequests(stub, 'recap'), recorded)
  }
}

test('partly-addressed-then-finished in a chat: nothing stays under asked but not addressed once turn 2 does it', async ({
  orcaPage,
  sessionServicesStub
}, testInfo) => {
  test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  test.fail(
    true,
    'turn 1 lists nothing as not addressed while /customers is open: no judge answers in this run'
  )
  // Two turns with the scheduler's 4 minutes between their automatic passes.
  test.setTimeout(600_000)
  await useScriptedSessionServices(orcaPage, sessionServicesStub)
  const { problems, unrecorded } = await runChatScenario(
    orcaPage,
    testInfo,
    sessionServicesStub,
    'partly-addressed-then-finished',
    'Paginate orders and customers'
  )
  expect(unrecorded).toEqual([])
  expect(problems).toEqual([])
})

test('addressed-same-turn in a chat: the request is listed under what you asked and its fix as done', async ({
  orcaPage,
  sessionServicesStub
}, testInfo) => {
  test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  test.fail(true, 'the request is missing under what you asked')
  // One turn, its registry scans and one recap pass.
  test.setTimeout(240_000)
  await useScriptedSessionServices(orcaPage, sessionServicesStub)
  const { problems, unrecorded } = await runChatScenario(
    orcaPage,
    testInfo,
    sessionServicesStub,
    'addressed-same-turn',
    'Checkout empty cart crash'
  )
  expect(unrecorded).toEqual([])
  expect(problems).toEqual([])
})

test('declined-with-a-reason in a chat: a request the agent refused with a reason is not listed as overlooked', async ({
  orcaPage,
  sessionServicesStub
}, testInfo) => {
  test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  test.fail(true, 'where it stands says nothing of the refusal')
  // One turn, its registry scans and one recap pass.
  test.setTimeout(240_000)
  await useScriptedSessionServices(orcaPage, sessionServicesStub)
  const { problems, unrecorded } = await runChatScenario(
    orcaPage,
    testInfo,
    sessionServicesStub,
    'declined-with-a-reason',
    'Delete old migrations'
  )
  expect(unrecorded).toEqual([])
  expect(problems).toEqual([])
})

const FAILURE_TURN: Turn = {
  user: 'Rename the export button to Download CSV.',
  agent: 'Renamed the export button to Download CSV in the reports toolbar and updated its test.'
}
const FAILURE_REASON = 'scripted failure'
const AFTER_FAILURE_RECAP = {
  title: 'Export button rename',
  goal: 'Scripted goal: the export button says what it downloads.',
  standing: 'Scripted standing: the button is renamed and its test updated.',
  asked: 'Scripted ask: rename the export button to Download CSV',
  did: 'Scripted work: renamed the export button and updated its test',
  decision: 'Scripted decision: keep the button in the reports toolbar'
}
/** How long the user watches the failed recap with nothing happening in the chat. */
const IDLE_AFTER_FAILURE_MS = 90_000

test('summarizer failure in a chat: the failed recap is written without new chat activity once the model answers again', async ({
  orcaPage,
  sessionServicesStub
}, testInfo) => {
  test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  test.fail(true, 'a failed pass is not tried again until new chat activity or Refresh')
  // A failed pass, the 90 s the test waits for a retry, then a Refresh.
  test.setTimeout(360_000)
  const script = {
    chatTitle: 'Rename export button',
    summary: ROW_STATUS_LINE,
    recap: AFTER_FAILURE_RECAP,
    chat: chatScript([FAILURE_TURN])
  }
  await useScriptedSessionServices(orcaPage, sessionServicesStub)
  writeSessionServicesScript(sessionServicesStub, { ...script, recapFailure: FAILURE_REASON })

  const chat = await startStubChat(orcaPage, sessionServicesStub)
  await runChatTurn(orcaPage, chat, FAILURE_TURN)
  const sessionId = await chatLiveSessionId(orcaPage, chat)
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(orcaPage)
        return (await readSessionRecap(orcaPage, sessionId)).state
      },
      { timeout: 60_000, message: 'the failing pass never ended' }
    )
    .toBe('failed')
  const panel = await openRecapPanel(orcaPage, sessionId)
  const note = panel.locator('[data-recap-note]')
  await expect(note).toBeVisible()
  const failed = await captureRecapCheckpoint(
    orcaPage,
    testInfo,
    sessionServicesStub,
    sessionId,
    'failed-pass',
    'failed pass'
  )
  const failedNote = await note.textContent()

  writeSessionServicesScript(sessionServicesStub, script)
  // Only the stub's log is read while idle: nothing here may count as a look or as activity.
  const retriedUnprompted = await expect
    .poll(() => readUtilityRequests(sessionServicesStub, 'recap').length, {
      timeout: IDLE_AFTER_FAILURE_MS,
      intervals: [5_000]
    })
    .toBeGreaterThan(failed.requests)
    .then(
      () => true,
      () => false
    )
  const idle = await captureRecapCheckpoint(
    orcaPage,
    testInfo,
    sessionServicesStub,
    sessionId,
    'after-idle',
    'after idle'
  )

  await panel.locator('[data-recap-refresh]').click()
  await waitForChatRecapPass(orcaPage, sessionId, 0, 60_000)
  await expect(panel.locator('[data-recap-section="requests"]')).toBeVisible()
  const refreshed = await captureRecapCheckpoint(
    orcaPage,
    testInfo,
    sessionServicesStub,
    sessionId,
    'after-refresh',
    'after refresh'
  )

  saveRecapEvidenceJson(testInfo, 'observed', { failedNote, retriedUnprompted })
  expect(failed.view).toMatchObject({ state: 'failed', recap: null })
  expect(failed.view.failure).toContain(FAILURE_REASON)
  expect(failedNote).toContain(FAILURE_REASON)
  expect(refreshed.view).toMatchObject({ state: 'ready', failure: null })
  expect(refreshed.panel?.asked).toEqual([AFTER_FAILURE_RECAP.asked])
  expect(retriedUnprompted, 'no recap request followed the failed one in 90 s of idle').toBe(true)
  expect(idle.view).toMatchObject({ state: 'ready', failure: null })
})

/** The scenario's own wait after the restart, with room for the settle delay of a pass nobody should start. */
const RESTART_SETTLE_MS = 10_000

test('restart-mid-session in a chat: the recap survives a relaunch without a model request and turn 2 clears the open ask', async ({
  sessionServicesStub,
  seededRepoPath,
  launchEnv
}, testInfo) => {
  test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
  test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
  test.fail(
    true,
    'the open tracking ask is never listed as not addressed, and turn 2 lists it again under what you asked'
  )
  // A relaunch, then two turns with the scheduler's 4 minutes between their automatic passes.
  test.setTimeout(600_000)
  const scenarioId = 'restart-mid-session'
  const { turns, checks } = readRecapScenarioTurns(scenarioId)
  const recorded = recordedRecapRepliesWithRepairs(scenarioId)
  const session = createRestartSession(testInfo, { PATH: launchEnv.PATH ?? '' })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await attachRepoAndOpenTerminal(first.page, seededRepoPath)
    await useScriptedSessionServices(first.page, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, {
      recapReplies: recorded,
      chatTitle: 'Reorder button',
      summary: ROW_STATUS_LINE,
      chat: chatScript(turns)
    })
    const firstChat = await startStubChat(first.page, sessionServicesStub)
    const tabId = await firstChat.tab.getAttribute('data-tab-id')
    await runChatTurn(first.page, firstChat, turns[0])
    const sessionId = await chatLiveSessionId(first.page, firstChat)
    const beforeRestart = await waitForChatRecapPass(first.page, sessionId, 0, 60_000)
    // The scenario's user does not open the recap before the restart: the chat as it stands, and the view.
    await saveRecapEvidence(first.page, testInfo, 'before-restart', sessionId, sessionServicesStub)
    const requestsBeforeRestart = readUtilityRequests(sessionServicesStub, 'recap').length

    await session.close(app)
    app = null
    const second = await session.launch()
    app = second.app
    const page = second.page
    await waitForSessionReady(page)
    await expect
      .poll(
        async () => {
          await rescanLiveSessions(page)
          return (await readStubChatLiveSession(page, firstChat))?.id
        },
        { timeout: 60_000, message: 'the relaunched app lists no session for the chat' }
      )
      .toBe(sessionId)
    const askedOnRestart = await expect
      .poll(() => readUtilityRequests(sessionServicesStub, 'recap').length, {
        timeout: RESTART_SETTLE_MS
      })
      .toBeGreaterThan(requestsBeforeRestart)
      .then(
        () => true,
        () => false
      )
    const checkpoints = [
      await captureRecapCheckpoint(
        page,
        testInfo,
        sessionServicesStub,
        sessionId,
        'after-restart',
        checks[0].label
      )
    ]
    const requestsAfterRestart = readUtilityRequests(sessionServicesStub, 'recap').length

    const root = page.locator('[data-native-chat-root="true"]')
    const chat: StubChat = {
      ...firstChat,
      tab: page.locator(`[data-testid="sortable-tab"][data-tab-id="${tabId}"]`),
      composer: root.getByRole('textbox'),
      root
    }
    await runChatTurn(page, chat, turns[1])
    await waitForChatRecapPass(
      page,
      sessionId,
      beforeRestart.recap?.updatedAt ?? 0,
      NEXT_AUTOMATIC_PASS_MS
    )
    checkpoints.push(
      await captureRecapCheckpoint(
        page,
        testInfo,
        sessionServicesStub,
        sessionId,
        'after-turn-2',
        checks[1].label
      )
    )

    saveRecapEvidenceJson(testInfo, 'observed', {
      askedOnRestart,
      requestsBeforeRestart,
      requestsAfterRestart,
      // The recap so far as each request carried it: its `firstRequest` is the registry's title for the chat.
      carriedRecaps: readUtilityRequests(sessionServicesStub, 'recap').map(({ prompt }) =>
        prompt.slice(prompt.lastIndexOf('<recap>'), prompt.lastIndexOf('<new_messages>'))
      )
    })
    expect(
      unrecordedRecapRequests(readUtilityRequests(sessionServicesStub, 'recap'), recorded)
    ).toEqual([])
    expect(askedOnRestart, 'the relaunch alone made a recap request').toBe(false)
    expect(requestsAfterRestart, 'opening the recap after the relaunch made a recap request').toBe(
      requestsBeforeRestart
    )
    expect(checkpoints[0].view.recap).toEqual(beforeRestart.recap)
    expect([
      ...recapPanelMismatches(checkpoints),
      ...failedRecapChecks(checkpoints, checks)
    ]).toEqual([])
  } finally {
    await session.dispose(app ?? undefined)
  }
})
