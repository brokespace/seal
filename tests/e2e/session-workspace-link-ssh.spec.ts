// A session on an SSH machine is listed under that machine's checkout, in the project of the local checkout of the same repository.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { cleanupTestRepository } from './global-teardown'
import { readLiveSessions, rescanLiveSessions } from './helpers/live-session-registry'
import { expect, test } from './helpers/orca-app'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/orca-restart'
import { startOrcadConvertHost } from './helpers/orcad-convert-host'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { createSeededTestRepo } from './helpers/seeded-test-repo'
import { showSidebar, workspaceSessionRow } from './helpers/sidebar-session-row'
import { waitForSessionReady } from './helpers/store'
import type { LiveSession } from '../../src/shared/live-sessions/live-session-types'

test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs Docker')
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

const MACHINE = 'seal-e2e-ssh-checkout'
/** Both checkouts name this remote, which is what makes them one project. */
const ORIGIN = 'https://git.example.test/acme/shared-checkout.git'
const PROJECT_KEY = 'git:git.example.test/acme/shared-checkout'
const PROJECT_SECTION = 'project:git:git.example.test/acme/shared-checkout'
// The session the transcript fixture names, the folder it was recorded in and its first prompt.
const AGENT_SESSION_ID = '38c0f043-22db-4748-8c78-765955c1a6ea'
const AGENT_FIXTURE_CWD = '/srv/shop'
const AGENT_PROMPT = 'Rename OrderSummary to OrderReceipt everywhere.'
const AGENT_TRANSCRIPT = path.join(
  process.cwd(),
  'src/main/live-sessions/discovery/__fixtures__/claude-idle.jsonl'
)

/** A process named `claude` in the folder, with a transcript recorded there: what the session scan looks for. */
function startAgentOnHost(exec: (command: string) => string, cwd: string): void {
  const projectDir = `~/.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`
  const transcript = readFileSync(AGENT_TRANSCRIPT, 'utf8').replaceAll(
    `"cwd":"${AGENT_FIXTURE_CWD}"`,
    `"cwd":${JSON.stringify(cwd)}`
  )
  exec(
    `mkdir -p ${projectDir} && ` +
      `echo ${Buffer.from(transcript).toString('base64')} | base64 -d > ${projectDir}/${AGENT_SESSION_ID}.jsonl && ` +
      `cd ${cwd} && (setsid bash -c 'exec -a claude sleep 86400' </dev/null >/dev/null 2>&1 &)`
  )
}

/** The machine's session, once the registry has attached it to a workspace. */
async function waitForLinkedSessionOnMachine(page: Page): Promise<LiveSession> {
  let found: LiveSession | undefined
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        found = (await readLiveSessions(page)).find(
          (session) =>
            session.providerSessionId === AGENT_SESSION_ID && session.machine.kind === 'remote'
        )
        return found?.workspace !== undefined
      },
      { timeout: 120_000, message: 'the session on the SSH machine got no workspace' }
    )
    .toBe(true)
  return found!
}

test('a session on an SSH machine is listed under its checkout there, in the same project as the local checkout', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launches through a restart session.
{}, testInfo) => {
  // Starting the Docker SSH host and launching the app twice takes over a minute on a cold runner.
  test.setTimeout(5 * 60_000)
  const host = startOrcadConvertHost('docker', testInfo)
  const localRepo = createSeededTestRepo({ publishPath: false })
  const session = createRestartSession(testInfo)
  let app: ElectronApplication | null = null
  try {
    const exec = host.exec
    if (!exec) {
      throw new Error('the Docker host runs commands as its SSH user')
    }
    execFileSync('git', ['remote', 'add', 'origin', ORIGIN], { cwd: localRepo, stdio: 'pipe' })
    exec(`git -C ${host.remoteRepoPath} remote add origin ${ORIGIN}`)
    startAgentOnHost(exec, host.remoteRepoPath)

    // The first launch registers the local checkout and creates the profile the SSH machine is saved into.
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    const localWorktreeId = await attachRepoAndOpenTerminal(first.page, localRepo)
    await session.close(app)
    app = null
    const seeded = seedRelayEraProfile(
      session.userDataDir,
      { ...host.input, label: MACHINE },
      { repoPath: host.remoteRepoPath, folderPath: host.remoteFolderPath },
      {
        gitRemoteIdentity: {
          canonicalKey: 'git.example.test/acme/shared-checkout',
          remoteName: 'origin',
          remoteUrl: ORIGIN
        }
      }
    )

    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const connection = await page.evaluate(async (targetId) => {
      const state = await window.api.ssh.connect({ targetId })
      return { status: state?.status ?? null, managedServer: state?.managedServer ?? null }
    }, seeded.targetId)
    // A plain SSH machine: Seal makes no project there, so the session can only join the registered checkout.
    expect(connection).toEqual({ status: 'connected', managedServer: null })
    await showSidebar(page)

    const listed = await waitForLinkedSessionOnMachine(page)
    expect(listed.machine.label).toBe(MACHINE)
    expect(listed.cwd).toBe(host.remoteRepoPath)
    expect(listed.workspace).toEqual({ worktreeId: seeded.worktreeId, projectKey: PROJECT_KEY })

    await expect(workspaceSessionRow(page, seeded.worktreeId, listed.id)).toContainText(
      AGENT_PROMPT
    )
    const workspace = (worktreeId: string) =>
      page.locator(`[data-worktree-sidebar] [data-worktree-id="${worktreeId}"]`)
    // One project section holds the local checkout and the machine's.
    await expect(workspace(localWorktreeId)).toHaveAttribute(
      'data-worktree-section-key',
      PROJECT_SECTION
    )
    await expect(workspace(seeded.worktreeId)).toHaveAttribute(
      'data-worktree-section-key',
      PROJECT_SECTION
    )
    await expect(
      workspace(seeded.worktreeId).locator('[data-slot="badge"]').filter({ hasText: MACHINE })
    ).toBeVisible()
    await expect(
      workspace(localWorktreeId).locator('[data-slot="badge"]').filter({ hasText: MACHINE })
    ).toHaveCount(0)
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.cleanup()
      cleanupTestRepository(localRepo)
    }
  }
})
