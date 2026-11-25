import type { Locator } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import { readOnMachine } from './agent-config-machine-seed'
import { expectNoSecretsOnPage, type JourneyEnv } from './agent-config-machine-journey'
import { chooseAgent, chooseOption, openTab } from './agent-config-page-driver'

/** The same page for Codex: TOML edited by key, comments and other tables left alone. */
export async function manageCodex(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  await chooseAgent(page, panel, { id: 'codex', label: 'Codex' })
  const docs = await openTab(panel, 'documents')
  await expect(docs.locator('[data-agent-config-doc="AGENTS.md"]')).toBeVisible()
  await expect(docs.locator('[data-agent-config-doc="summarize"]')).toBeVisible()

  const mcp = await openTab(panel, 'mcp')
  await expect(mcp.locator('[data-agent-config-mcp="user:docs"]')).toContainText('npx -y docs-mcp')
  await expect(mcp.locator('[data-agent-config-mcp="user:remote"]')).toContainText(
    'Token read from an environment variable'
  )
  await expectNoSecretsOnPage(page)

  const settings = await openTab(panel, 'settings')
  await chooseOption(
    page,
    settings.getByRole('combobox', { name: 'Approval policy' }).first(),
    'never'
  )
  await expect
    .poll(() => readOnMachine(target, '.codex/config.toml'))
    .toContain('approval_policy = "never"')
  await settings.getByRole('textbox', { name: 'New profile name' }).fill('careful')
  await settings.locator('[data-agent-config-profile-add]').click()
  await expect(settings.getByText('Profile: careful')).toBeVisible()
  await shot(`${target.key}-10-codex-settings`)

  const toml = readOnMachine(target, '.codex/config.toml')
  expect(toml).toContain('# Codex settings\nmodel = "gpt-5" # the default\n')
  expect(toml).toContain('[profiles.careful]\napproval_policy = "on-request"')
  expect(toml).toContain('# Servers\n[mcp_servers.docs]')
  expect(toml).toContain('DOCS_TOKEN = "codex-secret-4"')
  expect(target.sh('stat -c %a ~/.codex/config.toml').toString().trim()).toBe('600')
  await chooseAgent(page, panel, { id: 'claude', label: 'Claude Code' })
}
