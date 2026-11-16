import type { Page, TestInfo } from '@stablyai/playwright-test'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from './helpers/orca-app'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import {
  configureDiscoverableStubAgentClis,
  launchDiscoverableStubAgentCli,
  STUB_CLI_FINISH_TURN,
  STUB_CLI_KEEPS_WORKING,
  writeDiscoverableStubAgentCli,
  type StubAgentCliLaunch
} from './helpers/discoverable-stub-agent-cli'
import { getGoldenStubAgentLaunchEnv } from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { sendToTerminal } from './helpers/terminal'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'

// The fixture directory makes the tab bar list Claude and Codex; the launch runs the stubs below.
test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

const SCAN_BEACON_SESSION = '5ca9bea0-0000-4000-8000-000000000000'
const FIRST_PROMPT = `first task ${STUB_CLI_KEEPS_WORKING}`

/**
 * A transcript no agent runs. Only a whole scan reads what is appended to it, so its record
 * showing the newest line tells that a scan has passed.
 */
function appendToScanBeacon(home: string, text: string): void {
  const dir = path.join(home, '.claude', 'projects', '-scan-beacon')
  mkdirSync(dir, { recursive: true })
  appendFileSync(
    path.join(dir, `${SCAN_BEACON_SESSION}.jsonl`),
    `${JSON.stringify({
      sessionId: SCAN_BEACON_SESSION,
      cwd: '/scan-beacon',
      type: 'assistant',
      uuid: `${SCAN_BEACON_SESSION}-${text}`,
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' }
    })}\n`
  )
}

/** Every record that could be the stub's: its process, the session it names, its pane, its folder. */
function recordsOf(sessions: readonly LiveSession[], stub: StubAgentCliLaunch): LiveSession[] {
  return sessions.filter(
    (session) =>
      session.provider === stub.agent &&
      (session.pid === stub.pid ||
        session.providerSessionId === stub.sessionId ||
        session.cwd === stub.cwd ||
        (session.surface.kind === 'cli' && session.surface.paneKey === stub.paneKey))
  )
}

function paneRecord(session: LiveSession) {
  return {
    id: session.id,
    origin: session.origin,
    surface: session.surface,
    sealPaneRoutes: session.inputRoutes.filter((route) => route.kind === 'seal-pane'),
    canSend: session.capabilities?.send,
    pid: session.pid
  }
}

function expectedPaneRecord(stub: StubAgentCliLaunch) {
  return {
    id: `local:${stub.agent}:${stub.sessionId}`,
    origin: 'seal',
    surface: { kind: 'cli', paneKey: stub.paneKey },
    sealPaneRoutes: [{ kind: 'seal-pane', paneKey: stub.paneKey }],
    canSend: true,
    pid: stub.pid
  }
}

async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const dir = process.env.SEAL_LIVE_SESSIONS_SCREENSHOT_DIR
  const file = dir ? path.join(dir, `${name}.png`) : testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
}

async function showPane(page: Page, stub: StubAgentCliLaunch): Promise<void> {
  const tabId = stub.paneKey.split(':')[0]
  await page.evaluate((tabId) => {
    const state = window.__store?.getState()
    state?.setActiveView('terminal')
    state?.setActiveTab(tabId)
  }, tabId)
  await expect.poll(() => page.evaluate(() => window.__store?.getState().activeTabId)).toBe(tabId)
}

test('a Claude and a Codex CLI in Seal panes are each one session, scan after scan', async ({
  orcaPage,
  electronApp,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  // Six whole scans, up to 12 s apart while nothing changes, around one turn of two agents.
  test.setTimeout(240_000)
  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const home = await electronApp.evaluate(({ app }) => app.getPath('home'))
  const stubDir = mkdtempSync(path.join(os.tmpdir(), 'orca-e2e-stub-cli-'))
  registerPostElectronShutdownCleanup(async () => rmSync(stubDir, { recursive: true, force: true }))
  const clis = [
    writeDiscoverableStubAgentCli(stubDir, 'claude'),
    writeDiscoverableStubAgentCli(stubDir, 'codex')
  ]

  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await configureDiscoverableStubAgentClis(orcaPage, clis)
  const claude = await launchDiscoverableStubAgentCli(orcaPage, clis[0])
  const codex = await launchDiscoverableStubAgentCli(orcaPage, clis[1])
  const stubs = [claude, codex]

  /** Each listing with a stub listed twice, or no longer listed. A scan is what first lists Codex. */
  const notOnce: { agent: string; ids: string[] }[] = []
  const seen = new Set<string>()
  const list = async (): Promise<LiveSession[]> => {
    const { sessions } = await orcaCliResult<{ sessions: LiveSession[] }>(userDataDir, [
      'sessions',
      'list',
      '--all'
    ])
    for (const stub of stubs) {
      const ids = recordsOf(sessions, stub).map((session) => session.id)
      if (ids.length > 1 || (ids.length === 0 && seen.has(stub.agent))) {
        notOnce.push({ agent: stub.agent, ids })
      }
      if (ids.length > 0) {
        seen.add(stub.agent)
      }
    }
    return sessions
  }
  const listed = async (stub: StubAgentCliLaunch) => recordsOf(await list(), stub)
  const paneRecords = async (stub: StubAgentCliLaunch) => (await listed(stub)).map(paneRecord)
  const paneStatuses = async (stub: StubAgentCliLaunch) =>
    (await listed(stub)).map((session) => ({ ...paneRecord(session), status: session.status }))
  let scans = 0
  const acrossTwoScans = async (): Promise<void> => {
    for (let scan = 0; scan < 2; scan++) {
      const line = `scan ${++scans}`
      appendToScanBeacon(home, line)
      await expect
        .poll(
          async () =>
            (await list()).find((session) => session.providerSessionId === SCAN_BEACON_SESSION)
              ?.lastMessage,
          { timeout: 45_000, message: `No scan read the beacon's "${line}"` }
        )
        .toBe(line)
    }
    expect(notOnce).toEqual([])
  }
  // The workspace's badge narrows Active agents to the sessions in its folder: the two stubs.
  const activeAgents = orcaPage.getByTestId('active-agents')
  const rows = activeAgents.locator('[data-live-session-row]')
  const row = (id: string) => activeAgents.locator(`[data-live-session-row="${id}"]`)

  // Claude names its session as it starts. Codex names none before its first turn: until then
  // the scan lists its process, and that row must be the only one.
  const codexProcess = async () => (await listed(codex)).map((session) => session.pid)
  await expect.poll(() => paneRecords(claude)).toEqual([expectedPaneRecord(claude)])
  await expect.poll(codexProcess).toEqual([codex.pid])
  await acrossTwoScans()
  expect(await paneRecords(claude)).toEqual([expectedPaneRecord(claude)])
  expect(await codexProcess()).toEqual([codex.pid])
  const badge = orcaPage.locator('[data-live-sessions-badge="worktree"]')
  await expect(badge).toHaveText('2')
  await badge.click()
  await expect(rows).toHaveCount(2)
  await expect(row(`local:claude:${claude.sessionId}`)).toHaveCount(1)
  await shot(orcaPage, testInfo, 'before-first-prompt')

  for (const stub of stubs) {
    await sendToTerminal(orcaPage, stub.ptyId, `${FIRST_PROMPT}\r`)
  }
  for (const stub of stubs) {
    await expect
      .poll(() => paneStatuses(stub))
      .toEqual([{ ...expectedPaneRecord(stub), status: 'working' }])
  }
  await acrossTwoScans()
  for (const stub of stubs) {
    expect(await paneStatuses(stub)).toEqual([{ ...expectedPaneRecord(stub), status: 'working' }])
  }
  await expect(rows).toHaveCount(2)
  await shot(orcaPage, testInfo, 'working')

  for (const stub of stubs) {
    await sendToTerminal(orcaPage, stub.ptyId, `${STUB_CLI_FINISH_TURN}\r`)
  }
  for (const stub of stubs) {
    await expect
      .poll(() => paneStatuses(stub))
      .toEqual([{ ...expectedPaneRecord(stub), status: 'your-turn' }])
  }
  await acrossTwoScans()
  for (const stub of stubs) {
    expect(await paneStatuses(stub)).toEqual([{ ...expectedPaneRecord(stub), status: 'your-turn' }])
  }
  // What only the scan reads of a session is on its one record.
  const scanned = await Promise.all(
    stubs.map(async (stub) => {
      const [session] = await listed(stub)
      return { title: session.title, transcript: path.basename(session.transcriptPath ?? '') }
    })
  )
  expect(scanned).toEqual([
    { title: FIRST_PROMPT, transcript: `${claude.sessionId}.jsonl` },
    {
      title: FIRST_PROMPT,
      transcript: expect.stringMatching(new RegExp(`^rollout-.*-${codex.sessionId}\\.jsonl$`))
    }
  ])

  await expect(rows).toHaveCount(2)
  for (const stub of stubs) {
    await showPane(orcaPage, stub)
    await expect(row(`local:${stub.agent}:${stub.sessionId}`)).toHaveCount(1)
    await shot(orcaPage, testInfo, `${stub.agent}-pane`)
  }
  await orcaPage.evaluate(() => window.__store?.getState().setActiveView('home'))
  const homeSessions = orcaPage.locator('[data-sessions-machine="local"]')
  for (const stub of stubs) {
    await expect(
      homeSessions.locator(`[data-live-session-row="local:${stub.agent}:${stub.sessionId}"]`)
    ).toHaveCount(1)
  }
  await expect(
    homeSessions.locator(`[data-live-session-row="local:codex:pid-${codex.pid}"]`)
  ).toHaveCount(0)
  await shot(orcaPage, testInfo, 'home-sessions')
})
