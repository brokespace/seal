// T7.7: an SSH-only machine that already has projects, open tabs and a running agent gets the one-time
// offer; accepting it moves the machine to its Seal server and keeps workspace ids, tabs, pins and session
// ids. Needs Docker with cgroup v2 and ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost,
  type DockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import { serverCall } from './helpers/orcad-convert-flow'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { mutateStoppedProfileState } from './helpers/persisted-profile-state'
import {
  confirmServerInstall,
  openMachinesPage,
  readMachine,
  readMachineServer,
  sealServerFilesOnHost,
  SERVER_INSTALL_TIMEOUT_MS,
  serverInstallConfirmation,
  showMachine
} from './helpers/seal-server-install-machine'
import { toSshExecutionHostId } from '../../src/shared/execution-host'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-existing-box'
// The session the transcript fixture names.
const AGENT_SESSION_ID = '38c0f043-22db-4748-8c78-765955c1a6ea'
const AGENT_TRANSCRIPT = path.join(
  process.cwd(),
  'src/main/live-sessions/discovery/__fixtures__/claude-idle.jsonl'
)

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

type Row = Record<string, unknown>

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value : []
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null
}

function row(value: unknown): Row {
  if (!isRow(value)) {
    throw new Error('The seeded profile holds no such record')
  }
  return value
}

/** Pins the seeded folder workspace and editor tab, and returns the tab's id. */
function pinSeededWorkspaceAndTab(
  userDataDir: string,
  targetId: string,
  worktreeId: string
): string {
  return mutateStoppedProfileState(userDataDir, (state) => {
    const folder = rows(state.folderWorkspaces).find((row) => row.connectionId === targetId)
    const session = row(row(state.workspaceSessionsByHostId)[toSshExecutionHostId(targetId)])
    const tab = row(rows(row(session.unifiedTabs)[worktreeId])[0])
    folder!.isPinned = true
    tab.isPinned = true
    return String(tab.id)
  })
}

/** A process named `claude` in the project folder, with a transcript: what the session scan looks for. */
function startAgentOnHost(host: DockerSystemdSshHost, cwd: string): void {
  const projectDir = `~/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const transcript = readFileSync(AGENT_TRANSCRIPT).toString('base64')
  host.exec(
    `mkdir -p ${projectDir} && echo ${transcript} | base64 -d > ${projectDir}/${AGENT_SESSION_ID}.jsonl && ` +
      `cd ${cwd} && (setsid bash -c 'exec -a claude sleep 86400' </dev/null >/dev/null 2>&1 &)`,
    { user: 'seal' }
  )
}

async function machineSessions(
  page: Page,
  recordId: string
): Promise<{ id: string; pinned: boolean }[]> {
  await page.evaluate(() => window.api.liveSessions.refresh())
  const snapshot = await page.evaluate(() => window.api.liveSessions.snapshot())
  return snapshot.sessions
    .filter((session) => session.machine.hostId === recordId)
    .map((session) => ({ id: session.id, pinned: session.pinned === true }))
}

test('an SSH-only machine keeps its workspaces, tabs, pins and sessions when Seal server is installed', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launches and its host.
{}, testInfo) => {
  // Boots a systemd host, seeds a profile for it, and moves the machine to a server it installs.
  test.setTimeout(20 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    const repoPath = host.seedGitRepository('shop')
    const folderPath = host.exec('mkdir -p ~/projects/notes && cd ~/projects/notes && pwd', {
      user: 'seal'
    })
    startAgentOnHost(host, repoPath)

    // The first launch only creates the profile the saved SSH machine is written into.
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await session.close(app)
    app = null
    const seeded = seedRelayEraProfile(
      session.userDataDir,
      {
        label: MACHINE,
        host: host.ssh.host,
        port: host.ssh.port,
        username: host.ssh.username,
        identityFile: host.ssh.identityFile,
        identitiesOnly: true,
        relayGracePeriodSeconds: 1
      },
      { repoPath, folderPath }
    )
    const tabId = pinSeededWorkspaceAndTab(session.userDataDir, seeded.targetId, seeded.worktreeId)

    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    const before = (await readMachine(page, MACHINE))!
    expect(before).toMatchObject({
      connection: 'ssh',
      serverInstall: null,
      serverInstallAction: 'offer',
      ssh: { targetId: seeded.targetId }
    })
    await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), before.id)
    const agentSession = `${before.recordId}:claude:${AGENT_SESSION_ID}`
    await expect
      .poll(() => machineSessions(page, before.recordId), { timeout: 60_000 })
      .toEqual([{ id: agentSession, pinned: false }])
    await page.evaluate(
      (sessionId) => window.api.liveSessions.annotate({ sessionId, pinned: true }),
      agentSession
    )

    await test.step('the machine and the sidebar offer the install once, and nothing is on the host yet', async () => {
      await expect(page.locator('[data-seal-server-offers="1"]')).toBeVisible()
      await openMachinesPage(page)
      await showMachine(page, MACHINE)
      await expect(page.locator('[data-machine-server="offer"]')).toBeVisible()
      expect(sealServerFilesOnHost(host)).toEqual([])
      await page.screenshot({ path: testInfo.outputPath('offer.png'), animations: 'disabled' })
    })

    await test.step('accepting the offer asks before it writes anything', async () => {
      await page
        .locator('[data-machine-server="offer"] [data-machine-server-action="install"]')
        .click()
      await expect(serverInstallConfirmation(page)).toBeVisible()
      expect(sealServerFilesOnHost(host)).toEqual([])
      expect((await readMachine(page, MACHINE))?.serverInstall).toBeNull()
      await page.screenshot({
        path: testInfo.outputPath('offer-confirmation.png'),
        animations: 'disabled'
      })
    })

    await test.step('confirming moves the machine to its server', async () => {
      await confirmServerInstall(page)
      await expect
        .poll(() => readMachineServer(page, MACHINE), { timeout: SERVER_INSTALL_TIMEOUT_MS })
        .toEqual({
          connection: 'server',
          state: 'installed',
          manager: 'systemd-user',
          linger: true,
          reason: null
        })
      await expect(page.locator('[data-seal-server-offers]')).toHaveCount(0)
    })

    await test.step('the machine, its workspaces, tabs, pins and sessions are the ones it had', async () => {
      const after = (await readMachine(page, MACHINE))!
      expect(after).toMatchObject({
        id: before.id,
        recordId: before.recordId,
        ssh: { targetId: seeded.targetId }
      })
      const environmentId = after.server!.environmentId
      const repos = JSON.parse(await serverCall(page, environmentId, 'repo.list'))
      expect(rows(repos.result.repos).map((repo) => [repo.id, repo.path])).toEqual([
        [seeded.repoId, repoPath]
      ])
      const folders = JSON.parse(await serverCall(page, environmentId, 'folderWorkspace.list'))
      expect(
        rows(folders.result.folderWorkspaces).map((folder) => [folder.folderPath, folder.isPinned])
      ).toEqual([[folderPath, true]])
      const tabs = JSON.parse(
        await serverCall(page, environmentId, 'session.tabs.list', {
          worktree: `id:${seeded.worktreeId}`
        })
      )
      expect(rows(tabs.result.tabs).map((tab) => [tab.id, tab.isPinned === true])).toEqual([
        [tabId, true]
      ])
      await expect
        .poll(() => machineSessions(page, after.recordId), { timeout: 60_000 })
        .toEqual([{ id: agentSession, pinned: true }])
      await showMachine(page, MACHINE)
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      await page.screenshot({ path: testInfo.outputPath('moved.png'), animations: 'disabled' })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})
