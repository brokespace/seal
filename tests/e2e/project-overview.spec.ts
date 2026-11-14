// A project header's name opens the project's overview; its chevron folds the list.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/orca-app'
import { getStoreState } from './helpers/store'

const SESSION_ID = '0b5f0c7e-1111-4222-8333-944445555666'

/** A finished Claude session whose cwd is the project, as the live-session scanner finds it on disk. */
function seedClaudeSession(home: string, cwd: string): void {
  const dir = path.join(home, '.claude', 'projects', '-seal-e2e-project-overview')
  mkdirSync(dir, { recursive: true })
  const timestamp = new Date().toISOString()
  const lines = [
    { type: 'user', cwd, timestamp, message: { role: 'user', content: 'Fix the login bug' } },
    {
      type: 'assistant',
      timestamp,
      message: {
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done.' }]
      }
    }
  ]
  writeFileSync(
    path.join(dir, `${SESSION_ID}.jsonl`),
    lines.map((line) => `${JSON.stringify(line)}\n`).join('')
  )
}

test('project name opens the overview, the chevron folds, and agents open and start from it', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  await orcaPage.setViewportSize({ width: 1440, height: 900 })
  const header = orcaPage.locator('[data-repo-header-id]').first()
  await expect(header).toBeVisible({ timeout: 60_000 })
  const repo = await orcaPage.evaluate(() => {
    const [first] = window.__store!.getState().repos
    return { id: first.id, path: first.path, name: first.displayName }
  })
  seedClaudeSession(await electronApp.evaluate(({ app }) => app.getPath('home')), repo.path)

  const cards = orcaPage.locator('[role="option"][data-worktree-id]')
  const cardCount = await cards.count()
  expect(cardCount).toBeGreaterThan(0)

  // The chevron folds and unfolds without leaving the workspace.
  const fold = header.locator('button[data-repo-header-collapse-affordance]')
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  await fold.click()
  await expect(fold).toHaveAttribute('aria-expanded', 'false')
  await expect(cards).toHaveCount(0)
  expect(await getStoreState<string>(orcaPage, 'activeView')).toBe('terminal')
  await fold.click()
  await expect(cards).toHaveCount(cardCount)

  // The name opens the overview and leaves the list unfolded.
  await header.locator('[data-project-overview-link]').click()
  const page = orcaPage.locator(`[data-project-overview="${repo.id}"]`)
  await expect(page).toBeVisible()
  await expect(page.getByRole('heading', { level: 1, name: repo.name })).toBeVisible()
  await expect(fold).toHaveAttribute('aria-expanded', 'true')
  await expect(cards).toHaveCount(cardCount)
  await expect(page.locator('[data-project-overview-registration="local"]')).toContainText(
    repo.path
  )
  await expect(
    page.locator('[data-project-overview-workspaces] [data-worktree-card-surface]')
  ).toHaveCount(cardCount)
  await expect(page.locator('[data-project-overview-commits] li').first()).toBeVisible({
    timeout: 20_000
  })

  // The project's agent is listed and opens its session.
  const agent = page.locator(`[data-live-session-row="local:claude:${SESSION_ID}"]`)
  await expect(agent).toBeVisible({ timeout: 60_000 })
  await expect(agent).toContainText('Fix the login bug')
  await orcaPage.screenshot({ path: testInfo.outputPath('project-overview.png') })
  await agent.click()
  await expect
    .poll(() => getStoreState<string>(orcaPage, 'activeView'), { timeout: 10_000 })
    .toBe('sessions')

  // Back on the overview, New agent opens the composer for this project.
  await header.locator('[data-project-overview-link]').click()
  await expect(page).toBeVisible()
  await page.locator('[data-project-overview-new-agent]').click()
  await expect
    .poll(() =>
      orcaPage.evaluate(() => {
        const { activeModal, modalData } = window.__store!.getState()
        return { activeModal, repoId: modalData?.initialRepoId, agent: modalData?.agentSession }
      })
    )
    .toEqual({ activeModal: 'new-workspace-composer', repoId: repo.id, agent: true })
})
