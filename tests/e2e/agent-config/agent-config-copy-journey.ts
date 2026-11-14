import type { Page } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import type { Target } from '../home-chat-tools/tool-case-types'
import { backupsOf, readOnMachine } from './agent-config-machine-seed'
import { chooseOption, openMachineAgentConfig, openTab, rowMenu } from './agent-config-page-driver'

/** Copies a skill and an MCP server from one machine to another, across transports and agents. */
export async function copyBetweenMachines(env: {
  page: Page
  shot: (name: string) => Promise<void>
  from: Target
  to: Target
}): Promise<void> {
  const { page, shot, from, to } = env
  const panel = await openMachineAgentConfig(page, from.label)
  const dialog = page.locator('[data-agent-config-copy]')
  const copy = dialog.getByRole('button', { name: 'Copy', exact: true })
  const skill = '.claude/skills/deploy-app'

  const docs = await openTab(panel, 'documents')
  await rowMenu(page, docs.locator('[data-agent-config-doc="deploy-app"]'), 'Copy to…')
  await chooseOption(page, dialog.locator('#agent-config-copy-machine'), to.label)
  await copy.click()
  // The other machine has its own skill of that name: nothing is replaced until the user says so.
  await expect(dialog.getByRole('alert')).toContainText('already')
  expect(readOnMachine(to, `${skill}/SKILL.md`)).toContain(`edited on ${to.key}`)
  await dialog.getByRole('checkbox').click()
  await shot('copy-1-skill-to-another-machine')
  await copy.click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  expect(readOnMachine(to, `${skill}/SKILL.md`)).toBe(readOnMachine(from, `${skill}/SKILL.md`))
  expect(readOnMachine(to, `${skill}/scripts/deploy.sh`)).toContain('deployed')
  expect(to.sh(`stat -c %a ~/${skill}/scripts/deploy.sh`).toString().trim()).toBe('755')
  // What was there is in the backups, not gone.
  const replaced = backupsOf(to, skill).at(-1)
  expect(to.sh(`cat '${replaced}/SKILL.md'`).toString()).toContain(`edited on ${to.key}`)

  // Into a project on the other machine, by folder.
  await rowMenu(page, docs.locator('[data-agent-config-doc="deploy-app"]'), 'Copy to…')
  await chooseOption(page, dialog.locator('#agent-config-copy-machine'), to.label)
  await chooseOption(page, dialog.locator('#agent-config-copy-place'), 'Another folder…')
  await dialog.getByRole('textbox', { name: 'Project folder' }).fill(`${to.home}/work/app`)
  await copy.click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  expect(readOnMachine(to, `work/app/${skill}/SKILL.md`)).toContain(`edited on ${from.key}`)

  // A Claude Code server becomes a Codex server on the other machine; its token travels unseen.
  const mcp = await openTab(panel, 'mcp')
  await rowMenu(page, mcp.locator('[data-agent-config-mcp="user:sentry"]'), 'Copy to…')
  await chooseOption(page, dialog.locator('#agent-config-copy-machine'), to.label)
  await chooseOption(page, dialog.locator('#agent-config-copy-agent'), 'Codex')
  await shot('copy-2-mcp-server-to-another-agent')
  await copy.click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
  const toml = readOnMachine(to, '.codex/config.toml')
  expect(toml).toContain('[mcp_servers.sentry]')
  expect(toml).toContain('https://mcp.sentry.dev/mcp')
  expect(toml).toContain('Bearer sentry-secret-2')
  expect((await page.content()).includes('sentry-secret-2')).toBe(false)
}
