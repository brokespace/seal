// A running session in a folder no workspace covers gets a project made for it, which goes once the session has left.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  seedExternalClaudeSession,
  type ExternalClaudeSession
} from './helpers/external-claude-session'
import {
  readLiveSession,
  rescanLiveSessions,
  waitForLiveSession
} from './helpers/live-session-registry'
import { showSidebar } from './helpers/sidebar-session-row'

const CHECKOUT_PROMPT = 'Started in an unknown checkout'
const FOLDER_PROMPT = 'Started in a plain folder'

/** A repository with one commit on `main`, which Seal has never been shown. */
function createCheckout(folder: string): void {
  mkdirSync(folder)
  writeFileSync(path.join(folder, 'README.md'), '# A repository Seal has never seen\n')
  const git = (...args: string[]): void => {
    // Per-command config, so the developer's hooks and signing cannot fail the commit.
    execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
      cwd: folder,
      stdio: 'pipe'
    })
  }
  git('init', '--initial-branch=main')
  git('add', 'README.md')
  git('-c', 'user.email=e2e@test.local', '-c', 'user.name=E2E Test', 'commit', '-m', 'Initial')
}

function projectHeader(page: Page, name: string): Locator {
  return page.locator('[data-worktree-sidebar] [data-repo-header-id]').filter({ hasText: name })
}

/** The workspace at `folder`: a workspace's id ends in its folder. */
function workspaceAt(page: Page, folder: string): Locator {
  return page.locator(`[data-worktree-sidebar] [data-worktree-id$="::${folder}"]`)
}

async function startSession(
  electronApp: ElectronApplication,
  cwd: string,
  prompt: string
): Promise<ExternalClaudeSession> {
  const session = await seedExternalClaudeSession(electronApp, { cwd })
  session.submitPrompt(prompt)
  return session
}

/** One project named `name` holds one workspace at the session's folder, which lists the session. */
async function expectSessionInOwnProject(
  page: Page,
  session: ExternalClaudeSession,
  name: string,
  prompt: string
): Promise<void> {
  const listed = await waitForLiveSession(
    page,
    session.sessionId,
    (found) => found.workspace !== undefined,
    { message: `no workspace was made for the session in ${session.cwd}` }
  )
  const project = projectHeader(page, name)
  const workspace = workspaceAt(page, session.cwd)
  await expect(project).toHaveCount(1)
  await expect(workspace).toHaveCount(1)
  const projectId = await project.getAttribute('data-repo-header-id')
  await expect(workspace).toHaveAttribute('data-worktree-id', `${projectId}::${session.cwd}`)
  expect(listed.workspace?.worktreeId).toBe(`${projectId}::${session.cwd}`)
  await expect(
    workspace.locator(
      `[data-workspace-session-rows] [data-live-session-row="${session.sessionId}"]`
    )
  ).toContainText(prompt)
}

/** Takes away what a failed run left: Seal removes these projects itself when the test passes. */
async function removeProjectsUnder(page: Page, folder: string): Promise<void> {
  // Until a scan has seen the sessions gone, a removed project is made again.
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        return page.evaluate(async (folder) => {
          const state = window.__store!.getState()
          await state.fetchRepos({ runtimeEnvironmentId: null })
          const left = window
            .__store!.getState()
            .repos.filter((repo) => repo.path.startsWith(folder))
          for (const repo of left) {
            await state.removeProject(repo.id, { hostId: 'local' })
          }
          return left.length
        }, folder)
      },
      { timeout: 30_000 }
    )
    .toBe(0)
}

test('a session in an unknown checkout and one in a plain folder each get a project, which goes when they stop', async ({
  electronApp,
  orcaPage
}) => {
  test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')
  // Scans come 3 to 12 seconds apart, and a project outlives its last session by 20 seconds.
  test.setTimeout(240_000)
  await showSidebar(orcaPage)
  // Outside every temp root: a session under one shares the machine's home project instead.
  const scratch = mkdtempSync(path.join(os.homedir(), '.seal-e2e-session-workspaces-'))
  const checkout = path.join(scratch, 'uncharted-checkout')
  const folder = path.join(scratch, 'loose-notes')
  const sessions: ExternalClaudeSession[] = []
  try {
    createCheckout(checkout)
    mkdirSync(folder)
    const inCheckout = await startSession(electronApp, checkout, CHECKOUT_PROMPT)
    sessions.push(inCheckout)
    const inFolder = await startSession(electronApp, folder, FOLDER_PROMPT)
    sessions.push(inFolder)

    await expectSessionInOwnProject(orcaPage, inCheckout, 'uncharted-checkout', CHECKOUT_PROMPT)
    // A checkout's workspace is named for its branch, a plain folder's for the folder.
    await expect(workspaceAt(orcaPage, checkout)).toContainText('main')
    await expectSessionInOwnProject(orcaPage, inFolder, 'loose-notes', FOLDER_PROMPT)
    await expect(workspaceAt(orcaPage, folder)).toContainText('loose-notes')

    inCheckout.stop()
    inFolder.stop()
    // The grace, the sweep's interval and the scan that sees the sessions gone.
    for (const name of ['uncharted-checkout', 'loose-notes']) {
      await expect(projectHeader(orcaPage, name)).toHaveCount(0, { timeout: 90_000 })
    }
    await expect(workspaceAt(orcaPage, checkout)).toHaveCount(0)
    await expect(workspaceAt(orcaPage, folder)).toHaveCount(0)
    // The ended sessions stay listed, with no workspace.
    for (const session of sessions) {
      await expect
        .poll(async () => {
          const ended = await readLiveSession(orcaPage, session.sessionId)
          return { status: ended?.status ?? null, workspace: ended?.workspace ?? null }
        })
        .toEqual({ status: 'done', workspace: null })
    }
  } finally {
    for (const session of sessions) {
      session.stop()
    }
    try {
      await removeProjectsUnder(orcaPage, scratch)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
})
