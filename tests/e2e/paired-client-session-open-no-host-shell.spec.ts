// Opening a host session from the sidebar shows that session alone: no shell starts on the host.
import { existsSync, readFileSync } from 'node:fs'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { TEST_REPO_PATH_FILE } from './global-setup'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { createRestartSession } from './helpers/orca-restart'
import { seedLiveSession, stopAllSeededSessions } from './helpers/seeded-live-sessions'

test.afterEach(async () => {
  await stopAllSeededSessions()
})

async function callRuntime<TResult>(
  page: Page,
  environmentId: string,
  method: string,
  params: unknown
): Promise<TResult> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-only RPC result shape.
  return page.evaluate(
    async ({ environmentId, method, params }) => {
      const response = await window.api.runtimeEnvironments.call({
        selector: environmentId,
        method,
        params
      })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { environmentId, method, params }
  ) as Promise<TResult>
}

function hostTabTypes(page: Page, environmentId: string, worktreeId: string): Promise<string[]> {
  return callRuntime<{ tabs: { type: string }[] }>(page, environmentId, 'session.tabs.list', {
    worktree: `id:${worktreeId}`
  }).then((listed) => listed.tabs.map((tab) => tab.type))
}

function clientTabs(page: Page, worktreeId: string) {
  return page.evaluate((id) => {
    const state = window.__store!.getState()
    return {
      unified: (state.unifiedTabsByWorktree[id] ?? []).map((t) => t.contentType),
      terminals: (state.tabsByWorktree[id] ?? []).length
    }
  }, worktreeId)
}

test('opening a session in a host workspace creates no shell on the host', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its host launch.
{}, testInfo) => {
  test.setTimeout(300_000)
  const repoPath = existsSync(TEST_REPO_PATH_FILE)
    ? readFileSync(TEST_REPO_PATH_FILE, 'utf8').trim()
    : ''
  test.skip(!repoPath, 'no seeded repo')
  const session = createRestartSession(testInfo)
  let host: ElectronApplication | null = null
  let client: PairedElectronClient | null = null
  try {
    const launched = await session.launch()
    host = launched.app
    client = await launchPairedElectronClient(
      await createRuntimeDesktopPairingOffer(launched.page),
      testInfo,
      'session-open-no-host-shell'
    )
    const added = await callRuntime<{ repo: { id: string } }>(
      client.page,
      client.environmentId,
      'repo.add',
      { path: repoPath, kind: 'git' }
    )
    const findWorktree = () =>
      client!.page.evaluate(
        (repoId) =>
          window.__store
            ?.getState()
            .allWorktrees()
            .find((worktree) => worktree.repoId === repoId) ?? null,
        added.repo.id
      )
    await expect.poll(findWorktree, { timeout: 60_000 }).not.toBeNull()
    const worktree = (await findWorktree())!
    expect(await hostTabTypes(client.page, client.environmentId, worktree.id)).toEqual([])

    const seeded = await seedLiveSession(host, {
      cwd: worktree.path,
      status: 'your-turn',
      title: 'Host session to open'
    })
    await client.page.setViewportSize({ width: 1440, height: 900 })
    const findRowId = () =>
      client!.page.evaluate(async (providerSessionId) => {
        await window.api.liveSessions.refresh()
        const sessions = (await window.api.liveSessions.snapshot()).sessions
        return sessions.find((s) => s.id.endsWith(providerSessionId))?.id ?? null
      }, seeded.providerSessionId)
    await expect.poll(findRowId, { timeout: 60_000 }).not.toBeNull()
    const rowId = (await findRowId())!
    const row = client.page.locator(`[data-live-session-row="${rowId}"]`).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await row.click()
    await expect
      .poll(() => client!.page.evaluate(() => window.__store!.getState().activeWorktreeId))
      .toBe(worktree.id)
    await expect
      .poll(() => clientTabs(client!.page, worktree.id))
      .toEqual({ unified: ['external-agent-session'], terminals: 0 })
    // The stray shell came from the host's first, asynchronous tab list: give it time to land.
    await client.page.waitForTimeout(15_000)
    expect(await hostTabTypes(client.page, client.environmentId, worktree.id)).toEqual([])
    expect(await clientTabs(client.page, worktree.id)).toEqual({
      unified: ['external-agent-session'],
      terminals: 0
    })
  } finally {
    if (client) {
      await client.dispose()
    }
    if (host) {
      await session.close(host)
    }
    await session.dispose()
  }
})
