import type { Locator, Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import {
  addSeedWorkspaces,
  removeSeedWorkspaces,
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions,
  type SeedStatus,
  type SeedWorkspace,
  type SeededLiveSession
} from './helpers/seeded-live-sessions'

// The words docs/session-status.md gives each status.
const STATUS_LABELS: readonly { status: SeedStatus; label: string }[] = [
  { status: 'needs-permission', label: 'Waiting for approval' },
  { status: 'waiting-input', label: 'Asking you a question' },
  { status: 'errored', label: 'Error' },
  { status: 'working', label: 'Working' },
  { status: 'your-turn', label: 'Waiting on you' },
  { status: 'idle', label: 'Idle' }
]

type CardStyle = 'new' | 'classic' | 'compact'

async function showSidebar(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.locator('[data-repo-header-id]').first()).toBeVisible({ timeout: 60_000 })
}

function workspaceRows(page: Page, workspace: SeedWorkspace): Locator {
  return page.locator(
    `[data-worktree-sidebar] [data-workspace-session-rows="${workspace.id}"] [data-live-session-row]`
  )
}

async function setCardStyle(page: Page, style: CardStyle, inlineAgents: boolean): Promise<void> {
  await page.evaluate(
    async ({ style, inlineAgents }) => {
      const state = window.__store!.getState()
      await state.updateSettings({
        experimentalNewWorktreeCardStyle: style === 'new',
        compactWorktreeCards: style === 'compact'
      })
      const others = state.worktreeCardProperties.filter((property) => property !== 'inline-agents')
      state.setWorktreeCardProperties(inlineAgents ? [...others, 'inline-agents'] : others)
    },
    { style, inlineAgents }
  )
}

test.afterEach(async () => {
  await stopAllSeededSessions()
})

test('every session is a full row under its workspace, labelled with its status', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'The stub agents are found through the POSIX process table'
  )
  test.setTimeout(180_000)
  await showSidebar(orcaPage)
  const workspaces = await addSeedWorkspaces(orcaPage, 2)
  try {
    const seeded: { session: SeededLiveSession; label: string; title: string; home: number }[] = []
    for (const [index, { status, label }] of STATUS_LABELS.entries()) {
      const home = index % 2
      const title = `Seeded ${status}`
      const session = await seedLiveSession(electronApp, {
        cwd: workspaces[home].path,
        status,
        title
      })
      seeded.push({ session, label, title, home })
    }
    await waitForLiveSessions(
      orcaPage,
      Object.fromEntries(
        seeded.map(({ session }, index) => [session.id, STATUS_LABELS[index].status])
      )
    )

    for (const workspace of workspaces) {
      await expect(workspaceRows(orcaPage, workspace)).toHaveCount(3)
    }
    for (const { session, label, title, home } of seeded) {
      const row = orcaPage.locator(
        `[data-workspace-session-rows="${workspaces[home].id}"] [data-live-session-row="${session.id}"]`
      )
      await expect(row).toBeVisible()
      // A session that only ran a slash command has no prompt to take a title from.
      if (label !== 'Idle') {
        await expect(row).toContainText(title)
      }
      await expect(row.getByText(label, { exact: true })).toBeVisible()
    }
    // What needs the user leads its workspace.
    await expect(workspaceRows(orcaPage, workspaces[0]).first()).toContainText(
      'Waiting for approval'
    )
    await expect(workspaceRows(orcaPage, workspaces[1]).first()).toContainText(
      'Asking you a question'
    )
    await expect(orcaPage.locator('[data-worktree-sidebar]')).not.toContainText(/\d+ more/)

    await orcaPage
      .locator('[data-worktree-sidebar]')
      .screenshot({ path: testInfo.outputPath('sidebar-session-rows.png') })
  } finally {
    await stopAllSeededSessions()
    await removeSeedWorkspaces(orcaPage, workspaces)
  }
})

test('compact and classic cards, with or without inline agents, keep every session row', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'The stub agents are found through the POSIX process table'
  )
  test.setTimeout(180_000)
  await showSidebar(orcaPage)
  const [workspace] = await addSeedWorkspaces(orcaPage, 1)
  const before = await orcaPage.evaluate(() => {
    const state = window.__store!.getState()
    return {
      experimentalNewWorktreeCardStyle: state.settings?.experimentalNewWorktreeCardStyle === true,
      compactWorktreeCards: state.settings?.compactWorktreeCards === true,
      properties: [...state.worktreeCardProperties]
    }
  })
  try {
    const asking = await seedLiveSession(electronApp, {
      cwd: workspace.path,
      status: 'waiting-input',
      title: 'Seeded question'
    })
    const working = await seedLiveSession(electronApp, {
      cwd: workspace.path,
      provider: 'codex',
      status: 'working',
      title: 'Seeded work'
    })
    await waitForLiveSessions(orcaPage, {
      [asking.id]: 'waiting-input',
      [working.id]: 'working'
    })

    for (const style of ['new', 'classic', 'compact'] as const) {
      for (const inlineAgents of [true, false]) {
        await setCardStyle(orcaPage, style, inlineAgents)
        const rows = workspaceRows(orcaPage, workspace)
        await expect(rows).toHaveCount(2)
        await expect(rows.nth(0)).toContainText('Seeded question')
        await expect(rows.nth(0).getByText('Asking you a question', { exact: true })).toBeVisible()
        await expect(rows.nth(1)).toContainText('Seeded work')
        await expect(rows.nth(1).getByText('Working', { exact: true })).toBeVisible()
        await orcaPage.locator('[data-worktree-sidebar]').screenshot({
          path: testInfo.outputPath(`rows-${style}-${inlineAgents ? 'inline' : 'no-inline'}.png`)
        })
      }
    }
  } finally {
    await stopAllSeededSessions()
    await orcaPage.evaluate(async ({ properties, ...settings }) => {
      const state = window.__store!.getState()
      await state.updateSettings(settings)
      state.setWorktreeCardProperties(properties)
    }, before)
    await removeSeedWorkspaces(orcaPage, [workspace])
  }
})
