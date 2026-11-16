// Baseline of the session recap for a Claude Code session on another machine: reached over plain SSH, and through the Seal server (orcad) the desktop runs on that machine.
import path from 'node:path'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'
import type { SessionRecapView } from '../../src/shared/session-recap/session-recap-types'
import type { SessionSummariesStatus } from '../../src/shared/session-summaries/session-summary-contracts'
import {
  callLocalRuntime,
  readLiveSessions,
  readSessionRecap,
  rescanLiveSessions
} from './helpers/live-session-registry'
import {
  localSshdUnavailableReason,
  startLocalSshdMachines,
  type LocalSshdMachines,
  type LocalSshdUser
} from './helpers/local-sshd-machines'
import {
  captureRecapCheckpoint,
  failedRecapChecks,
  NEXT_AUTOMATIC_PASS_MS,
  readRecapScenarioTurns,
  RECAP_BASELINE_ENABLED,
  recapPanelMismatches,
  recordedRecapRepliesWithRepairs,
  saveRecapEvidence,
  saveRecapEvidenceJson,
  unrecordedRecapRequests,
  waitForRecapPass,
  type RecapCheckpoint,
  type RecapScenarioTurn
} from './helpers/recap-baseline'
import { seedRemoteClaudeSession, type RemoteClaudeSession } from './helpers/remote-claude-session'
import { installSealServerOverSshTarget } from './helpers/seal-server-install-machine'
import {
  expect,
  readUtilityRequests,
  SUPPORTED,
  test as sessionServicesTest,
  useScriptedSessionServices,
  writeSessionServicesScript,
  type SessionServicesStub,
  type UtilityRequestRecord
} from './helpers/session-services-stub'

/** A linux-x64-glibc orcad template (`build-orcad-template.mjs --targets linux-x64-glibc`), moved out of `out/`. */
const ORCAD_TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const SSHD_UNAVAILABLE = RECAP_BASELINE_ENABLED ? localSshdUnavailableReason() : null
const DESKTOP_AFTER_TURN_1 = 'on the desktop, after turn 1'
const DESKTOP_AFTER_TURN_2 = 'on the desktop, after turn 2'
const STUB_SCRIPT = path.join(
  process.cwd(),
  'tests',
  'e2e',
  'fixtures',
  'session-services-claude-stub.cjs'
)

type RemoteMachine = { sshd: LocalSshdMachines; user: LocalSshdUser }

const test = sessionServicesTest.extend<{
  remoteAccount: string
  remoteServer: boolean
  remoteMachine: RemoteMachine
}>({
  remoteAccount: ['sealrecap', { option: true }],
  remoteServer: [false, { option: true }],
  remoteMachine: async ({ remoteAccount }, provideFixture) => {
    const sshd = await startLocalSshdMachines([
      { username: remoteAccount, loginShell: '/bin/bash' }
    ])
    try {
      await provideFixture({ sshd, user: sshd.users[0] })
    } finally {
      sshd.dispose()
    }
  },
  orcaAppExtraEnv: async ({ remoteMachine, remoteServer }, provideFixture) => {
    await provideFixture({
      SSH_AUTH_SOCK: remoteMachine.sshd.agentSocket,
      ...(remoteServer && ORCAD_TEMPLATE ? { ORCA_ORCAD_TEMPLATE_PATH: ORCAD_TEMPLATE } : {})
    })
  }
})

// Before any fixture runs: the machine fixture creates a Linux account and starts an sshd.
test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
test.skip(SSHD_UNAVAILABLE !== null, SSHD_UNAVAILABLE ?? '')

const shQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

function sshTargetInput(machine: RemoteMachine, label: string) {
  return {
    label,
    host: machine.sshd.host,
    port: machine.sshd.port,
    username: machine.user.username,
    identityFile: machine.sshd.identityFile,
    identitiesOnly: true,
    relayGracePeriodSeconds: 1
  }
}

/** Adds the machine as the Machines list does and connects it over SSH. */
async function connectOverSsh(page: Page, machine: RemoteMachine, label: string): Promise<void> {
  const targetId = await page.evaluate(
    async (target) => (await window.api.ssh.addTarget({ target })).target.id,
    sshTargetInput(machine, label)
  )
  await expect
    .poll(
      async () => {
        const machines = await page.evaluate(() => window.api.machines!.list())
        return machines.find((candidate) => candidate.ssh?.targetId === targetId)?.id ?? null
      },
      { timeout: 30_000, message: `the Machines list never showed ${label}` }
    )
    .not.toBeNull()
  await page.evaluate(async (id) => {
    const machines = await window.api.machines!.list()
    const found = machines.find((candidate) => candidate.ssh?.targetId === id)
    await window.api.machines!.connect({ machineId: found!.id })
  }, targetId)
  await expect
    .poll(
      () =>
        page.evaluate(
          async (id) => (await window.api.ssh.getState({ targetId: id }))?.status,
          targetId
        ),
      { timeout: 120_000, message: `${label} never connected over SSH` }
    )
    .toBe('connected')
}

/** Installs the Seal server on the SSH host from the template at hand: the desktop deploys orcad there and pairs with it. */
async function connectThroughServer(
  page: Page,
  machine: RemoteMachine,
  label: string
): Promise<{ targetId: string; environmentId: string }> {
  const targetId = await page.evaluate(
    async (target) => (await window.api.ssh.addTarget({ target })).target.id,
    sshTargetInput(machine, label)
  )
  const installed = await installSealServerOverSshTarget(page, targetId)
  const server = installed.state?.managedServer
  if (server?.kind !== 'managed') {
    throw new Error(`expected a managed server on ${label}, got ${JSON.stringify(installed)}`)
  }
  return { targetId, environmentId: server.environmentId }
}

/** One method of the Seal server's own runtime, as a client paired to that server calls it. */
async function callServerRuntime<T>(
  page: Page,
  environmentId: string,
  method: string,
  params?: unknown
): Promise<T> {
  const reply = await page.evaluate((call) => window.api.runtimeEnvironments.call(call), {
    selector: environmentId,
    method,
    params,
    timeoutMs: 60_000
  })
  if (!reply.ok) {
    throw new Error(`${method} on the server failed: ${JSON.stringify(reply.error)}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the RPC contract types each method's result; the envelope carries it as unknown.
  return reply.result as T
}

/** The desktop registry's row for the remote session, once a scan of that machine has found it. */
async function waitForRemoteSession(
  page: Page,
  session: RemoteClaudeSession,
  matches: (found: LiveSession) => boolean,
  message: string
): Promise<LiveSession> {
  let found: LiveSession | null = null
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        found =
          (await readLiveSessions(page)).find(
            (candidate) =>
              candidate.providerSessionId === session.providerSessionId &&
              candidate.machine.kind === 'remote'
          ) ?? null
        return found !== null && matches(found)
      },
      { timeout: 120_000, intervals: [1_000], message }
    )
    .toBe(true)
  return found!
}

function runRemoteTurn(session: RemoteClaudeSession, turn: RecapScenarioTurn): void {
  session.submitPrompt(turn.user)
  for (const edit of turn.edits) {
    session.editFile(edit)
  }
  session.finishTurn(turn.agent)
}

/**
 * The scenario's two turns as the desktop sees them: a checkpoint after turn 1's pass, the recap
 * right after turn 2 without anyone looking, and a checkpoint after the next automatic pass.
 */
async function runTwoTurnsOnDesktop(
  page: Page,
  testInfo: TestInfo,
  stub: SessionServicesStub,
  session: RemoteClaudeSession,
  turns: readonly RecapScenarioTurn[],
  labels: { afterTurn1: string; afterTurn2: string },
  betweenTurns?: (found: LiveSession) => Promise<void>
): Promise<{
  found: LiveSession
  checkpoints: RecapCheckpoint[]
  beforeAutomaticPass: SessionRecapView
}> {
  runRemoteTurn(session, turns[0])
  const found = await waitForRemoteSession(
    page,
    session,
    (candidate) => candidate.status === 'your-turn',
    'the desktop never listed the remote session as stopped after turn 1'
  )
  const rescan = (): Promise<void> => rescanLiveSessions(page)
  const first = await waitForRecapPass(() => readSessionRecap(page, found.id), 0, 90_000, rescan)
  const checkpoints = [
    await captureRecapCheckpoint(page, testInfo, stub, found.id, 'after-turn-1', labels.afterTurn1)
  ]
  await betweenTurns?.(found)

  const requestsBeforeTurn2 = readUtilityRequests(stub, 'recap').length
  runRemoteTurn(session, turns[1])
  await waitForRemoteSession(
    page,
    session,
    (candidate) =>
      candidate.status === 'your-turn' && candidate.lastActivityAt > found.lastActivityAt,
    'the desktop never saw turn 2 end'
  )
  const beforeAutomaticPass = await saveRecapEvidence(
    page,
    testInfo,
    'after-turn-2-before-the-automatic-pass',
    found.id,
    stub
  )
  // Nobody looked and four minutes have not passed: the recap still stands where turn 1 left it.
  expect(readUtilityRequests(stub, 'recap')).toHaveLength(requestsBeforeTurn2)

  await waitForRecapPass(
    () => readSessionRecap(page, found.id),
    first.recap?.updatedAt ?? 0,
    NEXT_AUTOMATIC_PASS_MS,
    rescan
  )
  checkpoints.push(
    await captureRecapCheckpoint(
      page,
      testInfo,
      stub,
      found.id,
      'after-the-next-automatic-pass',
      labels.afterTurn2
    )
  )
  return { found, checkpoints, beforeAutomaticPass }
}

/** A scripted `claude` in the account's own PATH, so a recap made on that machine leaves its requests there. */
function installRemoteUtilityModel(user: LocalSshdUser): {
  command: string
  setScript: (script: unknown) => void
  recapRequests: () => UtilityRequestRecord[]
} {
  const dir = `${user.home}/.seal-e2e-utility-model`
  const command = `${dir}/claude`
  const launchLog = `${dir}/launches.jsonl`
  user.sh(`mkdir -p ${shQuote(dir)}`)
  user.sh(
    `cat > ${shQuote(command)} && chmod 755 ${shQuote(command)}`,
    `#!/bin/sh\nexec ${shQuote(process.execPath)} ${shQuote(STUB_SCRIPT)} ${shQuote(launchLog)} "$@"\n`
  )
  return {
    command,
    setScript: (script) =>
      void user.sh(
        `cat > ${shQuote(`${dir}/session-services-script.json`)}`,
        JSON.stringify(script)
      ),
    recapRequests: () =>
      user
        .sh(`cat ${shQuote(`${launchLog}.utility.jsonl`)} 2>/dev/null; true`)
        .toString()
        .split('\n')
        .filter(Boolean)
        .map((line): UtilityRequestRecord => JSON.parse(line))
        .filter((record) => record.kind === 'recap')
  }
}

test.describe('a Claude session on an SSH machine', () => {
  test.use({ remoteAccount: 'sealrecapssh' })

  test('remote-ssh-session over SSH: the documentation is asked-but-not-addressed after turn 1 and done after turn 2', async ({
    orcaPage,
    sessionServicesStub,
    remoteMachine
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    // An SSH connect, then two turns with the scheduler's 4 minutes between their automatic passes.
    test.setTimeout(600_000)
    const { turns, checks } = readRecapScenarioTurns('remote-ssh-session')
    const recorded = recordedRecapRepliesWithRepairs('remote-ssh-session')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, { recapReplies: recorded })
    await connectOverSsh(orcaPage, remoteMachine, 'recap-ssh-box')

    const session = seedRemoteClaudeSession(remoteMachine.user)
    try {
      const { found, checkpoints, beforeAutomaticPass } = await runTwoTurnsOnDesktop(
        orcaPage,
        testInfo,
        sessionServicesStub,
        session,
        turns,
        { afterTurn1: checks[0].label, afterTurn2: checks[1].label }
      )
      const requests = readUtilityRequests(sessionServicesStub, 'recap')
      saveRecapEvidenceJson(testInfo, 'where-the-recap-was-computed', {
        session: { id: found.id, machine: found.machine, transcriptPath: found.transcriptPath },
        desktopUtilityModelRecapRequests: requests.length,
        staleRightAfterTurn2: beforeAutomaticPass.stale
      })

      expect(found.machine).toMatchObject({ kind: 'remote', connection: 'ssh' })
      expect(found.transcriptPath).toBe(session.transcriptPath)
      expect(unrecordedRecapRequests(requests, recorded)).toEqual([])
      expect(recapPanelMismatches(checkpoints)).toEqual([])
      const failed = failedRecapChecks(checkpoints, checks)
      saveRecapEvidenceJson(testInfo, 'what-a-correct-recap-would-show-and-this-one-does-not', {
        failed,
        panel: checkpoints.map(({ label, panel }) => ({ label, panel }))
      })
      test.fail(
        true,
        'the documentation is never listed as asked-but-not-addressed after turn 1, nor recorded as done after turn 2'
      )
      expect(failed).toEqual([])
    } finally {
      session.stop()
    }
  })
})

test.describe('a Claude session on a machine that runs the Seal server', () => {
  test.use({ remoteAccount: 'sealrecapsrv', remoteServer: true })
  test.skip(
    !ORCAD_TEMPLATE,
    'needs ORCA_E2E_ORCAD_CONVERT_TEMPLATE: a linux-x64-glibc orcad template for the desktop to deploy over SSH'
  )

  test('remote-server-session through orcad: the server recaps it before any client opens it, and the desktop shows that recap and makes none', async ({
    orcaPage,
    sessionServicesStub,
    remoteMachine
  }, testInfo) => {
    test.skip(!RECAP_BASELINE_ENABLED, 'recap baseline runs with RECAP_E2E=1')
    test.skip(!SUPPORTED, 'the stub claude is a POSIX shell wrapper')
    // A server deployed over SSH, then two turns with the scheduler's 4 minutes between their automatic passes.
    test.setTimeout(720_000)
    const { turns, checks } = readRecapScenarioTurns('remote-server-session')
    const recorded = recordedRecapRepliesWithRepairs('remote-server-session')
    await useScriptedSessionServices(orcaPage, sessionServicesStub)
    writeSessionServicesScript(sessionServicesStub, { recapReplies: recorded })
    const serverModel = installRemoteUtilityModel(remoteMachine.user)
    serverModel.setScript({ recapReplies: recorded })
    const { environmentId } = await connectThroughServer(
      orcaPage,
      remoteMachine,
      'recap-server-box'
    )
    await callServerRuntime(orcaPage, environmentId, 'settings.mutateAgentLaunch', {
      type: 'command',
      agent: 'claude',
      value: serverModel.command
    })
    await callServerRuntime(orcaPage, environmentId, 'sessionSummaries.setModels', {
      summaries: { provider: 'claude', model: null, fallbackModel: null },
      recaps: null
    })
    await expect
      .poll(
        async () =>
          (
            await callServerRuntime<SessionSummariesStatus>(
              orcaPage,
              environmentId,
              'sessionSummaries.status'
            )
          ).recapConfigured,
        { timeout: 60_000, message: 'the server never found its own utility model' }
      )
      .toBe(true)

    const session = seedRemoteClaudeSession(remoteMachine.user)
    // The server lists its own sessions as local ones; the desktop lists the same one under the machine.
    const serverSessionId = `local:claude:${session.providerSessionId}`
    const serverView = (look: boolean): Promise<SessionRecapView> =>
      callServerRuntime<SessionRecapView>(orcaPage, environmentId, 'sessionRecap.get', {
        sessionId: serverSessionId,
        look
      })
    const serverCheckpoints: RecapCheckpoint[] = []
    try {
      const { found, checkpoints, beforeAutomaticPass } = await runTwoTurnsOnDesktop(
        orcaPage,
        testInfo,
        sessionServicesStub,
        session,
        turns,
        { afterTurn1: DESKTOP_AFTER_TURN_1, afterTurn2: DESKTOP_AFTER_TURN_2 },
        async () => {
          serverCheckpoints.push({
            label: checks[0].label,
            view: await serverView(false),
            requests: serverModel.recapRequests().length
          })
          saveRecapEvidenceJson(testInfo, 'server-before-anyone-opens-it', serverCheckpoints[0])
          await serverView(true)
          const opened = await waitForRecapPass(() => serverView(false), 0, 90_000)
          serverCheckpoints.push({
            label: checks[1].label,
            view: opened,
            requests: serverModel.recapRequests().length
          })
          saveRecapEvidenceJson(testInfo, 'server-after-a-client-opens-it', serverCheckpoints[1])
        }
      )
      const serverAfterTurn2 = await waitForRecapPass(
        () => serverView(false),
        serverCheckpoints[1].view.recap?.updatedAt ?? 0,
        NEXT_AUTOMATIC_PASS_MS
      )
      serverCheckpoints.push({
        label: checks[2].label,
        view: serverAfterTurn2,
        requests: serverModel.recapRequests().length
      })
      saveRecapEvidenceJson(testInfo, 'server-after-turn-2', serverCheckpoints[2])

      const desktopItem = checkpoints[1].view.recap?.did[0]?.id ?? ''
      const marked = await callLocalRuntime<SessionRecapView>(orcaPage, 'sessionRecap.mark', {
        sessionId: found.id,
        itemId: desktopItem,
        mark: 'done'
      })
      const serverMarks = (await serverView(false)).marks
      const desktopRequests = readUtilityRequests(sessionServicesStub, 'recap')
      const serverRequests = serverModel.recapRequests()
      saveRecapEvidenceJson(testInfo, 'where-the-recap-was-computed', {
        session: { id: found.id, machine: found.machine, transcriptPath: found.transcriptPath },
        serverSessionId,
        desktopUtilityModelRecapRequests: desktopRequests.length,
        serverUtilityModelRecapRequests: serverRequests.length,
        serverRequestsBeforeAnyoneOpenedIt: serverCheckpoints[0].requests,
        staleRightAfterTurn2: beforeAutomaticPass.stale,
        desktopMarksAfterTickingOnDesktop: marked.marks,
        serverMarksAfterTickingOnDesktop: serverMarks
      })

      const failed = [
        ...failedRecapChecks(serverCheckpoints, checks),
        ...failedRecapChecks(checkpoints, [
          { label: DESKTOP_AFTER_TURN_1, check: checks[1].check },
          { label: DESKTOP_AFTER_TURN_2, check: checks[2].check }
        ])
      ]
      saveRecapEvidenceJson(testInfo, 'what-a-correct-recap-would-show-and-this-one-does-not', {
        failed,
        panel: checkpoints.map(({ label, panel }) => ({ label, panel }))
      })

      expect(found.machine).toMatchObject({ kind: 'remote', connection: 'server' })
      // One recap, kept by the server that runs the session: the desktop asks its own model nothing.
      expect(desktopRequests).toEqual([])
      expect(serverMarks).toEqual(marked.marks)
      expect(unrecordedRecapRequests(serverRequests, recorded)).toEqual([])
      expect(recapPanelMismatches(checkpoints)).toEqual([])
      test.fail(
        true,
        'on the server as on the desktop, the documentation is never listed as asked-but-not-addressed, nor recorded as done after turn 2'
      )
      expect(failed).toEqual([])
    } finally {
      session.stop()
    }
  })
})
