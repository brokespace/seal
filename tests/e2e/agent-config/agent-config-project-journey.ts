import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import type { RealMachineSuite } from '../home-chat-tools/real-machine-targets'
import type { Target } from '../home-chat-tools/tool-case-types'
import { readOnMachine } from './agent-config-machine-seed'
import {
  chooseOption,
  closeEditor,
  editorSheet,
  openProjectAgentConfig,
  openTab
} from './agent-config-page-driver'

type Shot = (name: string) => Promise<void>

/** What a project's page shows and changes: its own files, and how they merge with the account's. */
async function manageProjectPanel(
  page: Page,
  panel: Locator,
  target: Target,
  shot: Shot,
  accountModel: string
): Promise<void> {
  const docs = await openTab(panel, 'documents')
  const doc = (name: string): Locator => docs.locator(`[data-agent-config-doc="${name}"]`)
  for (const name of ['CLAUDE.md', 'packages/api/CLAUDE.md', 'lint-fix', 'tester', 'ship']) {
    await expect(doc(name)).toBeVisible()
  }
  // Dependencies' instruction files are not the project's.
  await expect(doc('node_modules/dep/CLAUDE.md')).toHaveCount(0)
  await shot(`project-${target.key}-1-instructions-with-nested`)

  await docs.getByRole('button', { name: 'New', exact: true }).first().click()
  await page.getByRole('menuitem', { name: 'In a sub-folder…' }).click()
  const prompt = page
    .getByRole('dialog')
    .filter({ has: page.locator('#agent-config-nested-folder') })
  await prompt.locator('#agent-config-nested-folder').fill('packages/web')
  await prompt.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(editorSheet(page)).toBeVisible({ timeout: 30_000 })
  await closeEditor(page)
  await expect(doc('packages/web/CLAUDE.md')).toBeVisible()
  target.sh('test -f ~/work/app/packages/web/CLAUDE.md')

  // Which of the project's `.mcp.json` servers this user lets Claude Code use.
  const mcp = await openTab(panel, 'mcp')
  const server = (id: string): Locator => mcp.locator(`[data-agent-config-mcp="${id}"]`)
  const activation = (id: string): Locator =>
    server(id).getByRole('combobox', { name: 'Use in this project' })
  await expect(activation('project:tracker')).toContainText('Approved')
  await expect(activation('project:flaky')).toContainText('Disabled')
  await expect(activation('project:docs')).toContainText('Ask me first')
  await expect(server('user:docs')).toContainText('Not used here')
  await expect(server('local:scratch')).toBeVisible()
  await chooseOption(page, activation('project:flaky'), 'Approved')
  await expect
    .poll(() => JSON.parse(readOnMachine(target, 'work/app/.claude/settings.local.json')))
    .toMatchObject({ enabledMcpjsonServers: ['flaky'], disabledMcpjsonServers: [] })
  await shot(`project-${target.key}-2-mcp-active-in-project`)

  const plugins = await openTab(panel, 'plugins')
  await expect(plugins.locator('[data-agent-config-plugin="hello@local-mkt"]')).toContainText(
    'off by Only me settings'
  )
  await expect(plugins.locator('[data-agent-config-plugin="other@local-mkt"]')).toContainText(
    'on by Project settings'
  )
  await shot(`project-${target.key}-3-plugins-active-in-project`)

  // The merged view names the file each value comes from, and what it replaced.
  const merged = await openTab(panel, 'effective')
  const entry = (key: string): Locator => merged.locator(`[data-agent-config-effective="${key}"]`)
  await expect(entry('model')).toContainText('"opus"')
  await expect(entry('model')).toContainText('Project')
  await expect(entry('model')).toContainText(`"${accountModel}" (Account)`)
  await expect(entry('env.EDITOR')).toContainText('"nano"')
  await expect(entry('env.EDITOR')).toContainText('Only me')
  await expect(entry('permissions.allow')).toContainText('Bash(pnpm test:*)')
  await expect(entry('permissions.allow')).toContainText('Bash(git status:*)')
  await expect(entry('env.ANTHROPIC_API_KEY')).toContainText('••••••••')
  expect((await page.content()).includes('anthropic-secret-3')).toBe(false)
  await shot(`project-${target.key}-4-merged-view-with-sources`)
}

async function repoIdAt(page: Page, path: string): Promise<string | null> {
  return page.evaluate(
    (repoPath) =>
      window.__store?.getState().repos.find((repo) => repo.path === repoPath)?.id ?? null,
    path
  )
}

/** A project on this computer and one that lives on the Seal server, each from its own settings. */
export async function manageProject(env: {
  page: Page
  shot: Shot
  suite: RealMachineSuite
  local: Target
  overServer: Target
}): Promise<void> {
  const { page, shot, suite, local, overServer } = env
  // A plain folder, not a git checkout: agent files do not need a repository.
  const localPath = `${local.home}/work/app`
  await page.evaluate(async (path) => {
    const added = await window.api.repos.add({ path, kind: 'folder' })
    if ('error' in added) {
      throw new Error(added.error)
    }
    await window.__store!.getState().fetchReposForAllHosts()
  }, localPath)
  await expect.poll(() => repoIdAt(page, localPath)).not.toBeNull()
  const localPanel = await openProjectAgentConfig(page, (await repoIdAt(page, localPath))!)
  await manageProjectPanel(page, localPanel, local, shot, 'sonnet')

  const serverPath = `${overServer.home}/work/app`
  await suite.server.client.call('repo.add', { path: serverPath, kind: 'folder' })
  await page.evaluate(() => window.__store!.getState().fetchReposForAllHosts())
  await expect.poll(() => repoIdAt(page, serverPath), { timeout: 60_000 }).not.toBeNull()
  const serverPanel = await openProjectAgentConfig(page, (await repoIdAt(page, serverPath))!)
  // The machine journey before this one set the server account's model.
  await manageProjectPanel(page, serverPanel, overServer, shot, 'opus')
}
