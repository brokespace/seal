import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import type { Target } from '../home-chat-tools/tool-case-types'
import {
  backupsOf,
  ECHO_MCP_TOKEN,
  existsOnMachine,
  HTTP_MCP_TOKEN,
  jsonOnMachine,
  readOnMachine
} from './agent-config-machine-seed'
import {
  answerPrompt,
  chooseOption,
  closeEditor,
  confirmDialog,
  editorSheet,
  openTab,
  replaceEditorText,
  rowMenu,
  saveEditor
} from './agent-config-page-driver'

export type JourneyEnv = {
  page: Page
  target: Target
  shot: (name: string) => Promise<void>
  httpMcpUrl: string
  /** Real agent CLIs are on the machines' PATH, so plugin commands really install. */
  realCli: boolean
}

const MASK = '••••••••'
/** Every secret the fixture tree stores; none may ever reach the page. */
const STORED_SECRETS = ['docs-secret-1', 'sentry-secret-2', 'anthropic-secret-3', 'codex-secret-4']

export async function expectNoSecretsOnPage(
  page: Page,
  extra: readonly string[] = []
): Promise<void> {
  const html = await page.content()
  for (const secret of [...STORED_SECRETS, ...extra]) {
    expect(html.includes(secret), `the page shows ${secret.slice(0, 6)}…`).toBe(false)
  }
}

/** Instructions and skills: edit with validation, then create, duplicate, rename and delete. */
export async function manageDocuments(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  const docs = await openTab(panel, 'documents')
  const row = (name: string): Locator => docs.locator(`[data-agent-config-doc="${name}"]`)
  await expect(row('CLAUDE.md')).toBeVisible()
  await expect(row('deploy-app')).toContainText('Deploys the app to staging.')
  await expect(row('reviewer')).toBeVisible()
  // A skill with no description is listed with what is wrong with it.
  await expect(row('Broken Skill')).toContainText(/description/i)
  await shot(`${target.key}-1-instructions-and-skills`)

  const skill = '.claude/skills/deploy-app/SKILL.md'
  await row('deploy-app').getByRole('button').first().click()
  await expect(editorSheet(page).locator('.monaco-editor').first()).toBeVisible({ timeout: 30_000 })
  await replaceEditorText(page, '---\nname: deploy-app\n---\n\nNo description.\n')
  const issues = editorSheet(page).locator('[data-agent-config-issues]')
  await expect(issues).toContainText(/description/i)
  await expect(editorSheet(page).getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await shot(`${target.key}-2-skill-frontmatter-validation`)
  expect(readOnMachine(target, skill)).toContain('Deploys the app to staging.')

  const edited = `---\nname: deploy-app\ndescription: Deploys the app, edited on ${target.key}.\nlicense: MIT\n---\n\n# Deploy\n\nEdited from Seal.\n`
  await replaceEditorText(page, edited)
  await expect(issues).toHaveCount(0)
  await saveEditor(page)
  await expect(editorSheet(page).locator('.monaco-editor .view-lines')).toContainText(
    'Edited from Seal.'
  )
  await shot(`${target.key}-3-skill-editor-with-preview`)
  await closeEditor(page)
  expect(readOnMachine(target, skill)).toBe(edited)
  // The previous version is kept on the machine, and the script beside it is untouched.
  const kept = backupsOf(target, skill)
  expect(kept).toHaveLength(1)
  expect(target.sh(`cat '${kept[0]}'`).toString()).toContain('Deploys the app to staging.')
  expect(readOnMachine(target, '.claude/skills/deploy-app/scripts/deploy.sh')).toContain('deployed')

  await docs.locator('[data-agent-config-new="skill"]').click()
  await answerPrompt(page, 'release-notes', 'Create')
  await expect(editorSheet(page)).toBeVisible()
  await closeEditor(page)
  await expect(row('release-notes')).toBeVisible()
  expect(readOnMachine(target, '.claude/skills/release-notes/SKILL.md')).toContain(
    'name: release-notes'
  )

  await rowMenu(page, row('release-notes'), 'Duplicate…')
  await answerPrompt(page, 'release-notes-draft', 'Duplicate')
  await expect(row('release-notes-draft')).toBeVisible()

  await rowMenu(page, row('release-notes-draft'), 'Rename…')
  await answerPrompt(page, 'changelog', 'Rename')
  await expect(row('changelog')).toBeVisible()
  expect(readOnMachine(target, '.claude/skills/changelog/SKILL.md')).toContain('name: changelog')
  expect(existsOnMachine(target, '.claude/skills/release-notes-draft')).toBe(false)

  await rowMenu(page, row('changelog'), 'Delete…')
  await expect(page.locator('[data-agent-config-confirm]')).toContainText('backups')
  await confirmDialog(page, 'Delete')
  await expect(row('changelog')).toHaveCount(0)
  expect(existsOnMachine(target, '.claude/skills/changelog')).toBe(false)
  // Deleting moves the folder into the backups, where it can be restored from.
  const removed = backupsOf(target, '.claude/skills/changelog').at(-1)
  expect(target.sh(`cat '${removed}/SKILL.md'`).toString()).toContain('name: changelog')
}

/** Adds a row to the form's name/value table: `labels` are the two inputs' accessible names. */
async function addPair(
  form: Locator,
  labels: { name: string; value: string | RegExp },
  name: string,
  value: string
): Promise<void> {
  await form.getByRole('button', { name: 'Add', exact: true }).click()
  await form.getByRole('textbox', { name: labels.name }).last().fill(name)
  await form.getByRole('textbox', { name: labels.value }).last().fill(value)
}

const ENV_PAIR = { name: 'Environment variables: NAME', value: 'Environment variables: value' }
const HEADER_PAIR = { name: 'Headers: Authorization', value: /^Headers: Bearer/ }

async function saveServer(page: Page): Promise<void> {
  const form = page.locator('[data-agent-config-mcp-form]')
  await form.getByRole('button', { name: 'Save server', exact: true }).click()
  await expect(form).toBeHidden({ timeout: 30_000 })
}

async function testServer(row: Locator, status: string, text: string | RegExp): Promise<void> {
  await row.getByRole('button', { name: 'Test', exact: true }).click()
  const line = row.locator(`[data-agent-config-mcp-status="${status}"]`)
  await expect(line).toContainText(text, { timeout: 45_000 })
}

/** MCP servers in the account's file: masked, edited, added, tested, removed. */
export async function manageMcpServers(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot, httpMcpUrl } = env
  const mcp = await openTab(panel, 'mcp')
  const row = (name: string): Locator => mcp.locator(`[data-agent-config-mcp="user:${name}"]`)
  const form = page.locator('[data-agent-config-mcp-form]')
  await expect(row('docs')).toContainText('npx -y docs-mcp')
  await expect(row('sentry')).toContainText('Token stored in a header')
  await expectNoSecretsOnPage(page)

  // Editing around a hidden secret keeps it, and keeps what Seal has no field for.
  await rowMenu(page, row('docs'), 'Edit')
  await expect(
    form.getByRole('textbox', { name: 'Environment variables: value' }).first()
  ).toHaveValue(MASK)
  await form.locator('#agent-config-mcp-args').fill('-y\ndocs-mcp\n--verbose')
  await expectNoSecretsOnPage(page)
  await saveServer(page)
  const claudeJson = (...keys: string[]): unknown => jsonOnMachine(target, '.claude.json', ...keys)
  expect(claudeJson('mcpServers', 'docs')).toEqual({
    type: 'stdio',
    command: 'npx',
    args: ['-y', 'docs-mcp', '--verbose'],
    env: { DOCS_TOKEN: 'docs-secret-1', REGION: 'eu' },
    timeout: 9000
  })
  expect(claudeJson('userID')).toBe('u-979d3d357e5f')
  expect(claudeJson('oauthAccount')).toEqual({ emailAddress: 'brian@example.com' })
  expect(target.sh('stat -c %a ~/.claude.json').toString().trim()).toBe('600')

  await mcp.locator('[data-agent-config-mcp-add="user"]').click()
  await form.locator('#agent-config-mcp-name').fill('echo')
  await form.locator('#agent-config-mcp-command').fill(`${target.home}/bin/echo-mcp`)
  await addPair(form, ENV_PAIR, 'ECHO_TOKEN', ECHO_MCP_TOKEN)
  await shot(`${target.key}-4-mcp-server-form`)
  await saveServer(page)
  await expect(row('echo')).toBeVisible()
  expect(claudeJson('mcpServers', 'echo', 'env')).toEqual({ ECHO_TOKEN: ECHO_MCP_TOKEN })
  // The server only answers when the token really reached its environment on the machine.
  await testServer(row('echo'), 'connected', 'echo-mcp 0.4.2')

  await mcp.locator('[data-agent-config-mcp-add="user"]').click()
  await form.locator('#agent-config-mcp-name').fill('hosted')
  await chooseOption(page, form.locator('#agent-config-mcp-transport'), 'HTTP: a URL')
  await form.locator('#agent-config-mcp-url').fill(httpMcpUrl)
  await addPair(form, HEADER_PAIR, 'Authorization', `Bearer ${HTTP_MCP_TOKEN}`)
  await saveServer(page)
  await testServer(row('hosted'), 'connected', 'http-mcp 2.1.0')
  await expectNoSecretsOnPage(page, [ECHO_MCP_TOKEN, HTTP_MCP_TOKEN])
  await shot(`${target.key}-5-mcp-servers-tested`)

  // A wrong token is reported as needing sign-in, not as a broken server.
  await rowMenu(page, row('hosted'), 'Edit')
  await form.getByRole('textbox', { name: /^Headers: Bearer/ }).fill('Bearer wrong-token')
  await saveServer(page)
  await testServer(row('hosted'), 'needs-auth', /sign-in/i)

  await rowMenu(page, row('echo'), 'Remove…')
  await confirmDialog(page, 'Remove')
  await expect(row('echo')).toHaveCount(0)
  expect(Object.keys(claudeJson('mcpServers') ?? {}).toSorted()).toEqual([
    'docs',
    'hosted',
    'sentry'
  ])
  expect(claudeJson('mcpServers', 'sentry', 'headers', 'Authorization')).toBe(
    'Bearer sentry-secret-2'
  )
  expect(backupsOf(target, '.claude.json').length).toBeGreaterThanOrEqual(4)
}

/** Plugins: on/off is a settings key; installs and marketplaces go through `claude plugin`. */
export async function managePlugins(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot, realCli } = env
  const plugins = await openTab(panel, 'plugins')
  const plugin = (id: string): Locator => plugins.locator(`[data-agent-config-plugin="${id}"]`)
  const output = plugins.locator('[data-agent-config-command-output]')
  await expect(plugin('hello@local-mkt')).toContainText('Says hello')
  await expect(plugins.locator('[data-agent-config-marketplace="local-mkt"]')).toContainText(
    'spare'
  )

  await plugin('hello@local-mkt').getByRole('switch').click()
  await expect
    .poll(() => jsonOnMachine(target, '.claude/settings.json', 'enabledPlugins', 'hello@local-mkt'))
    .toBe(false)
  expect(jsonOnMachine(target, '.claude/settings.json', 'someFutureSetting')).toEqual({
    keep: ['me']
  })

  const marketplace = `${target.home}/seal-mkt`
  await plugins.getByRole('button', { name: 'Add marketplace', exact: true }).click()
  await answerPrompt(page, marketplace, 'Add', '#agent-config-marketplace-source')
  await expect(output).toContainText(`claude plugin marketplace add ${marketplace}`, {
    timeout: 120_000
  })
  await expect(output).toHaveAttribute('data-agent-config-command-output', 'ok')
  if (realCli) {
    // The real CLI registered the marketplace, so its plugin can be installed and removed again.
    const install = plugins.locator('[data-agent-config-install="greeter@seal-mkt"]')
    await install.click()
    await expect(plugin('greeter@seal-mkt')).toBeVisible({ timeout: 120_000 })
    await expect(output).toHaveAttribute('data-agent-config-command-output', 'ok')
    expect(
      jsonOnMachine(target, '.claude/plugins/installed_plugins.json', 'plugins', 'greeter@seal-mkt')
    ).toBeDefined()
    await shot(`${target.key}-6-plugins-and-marketplaces`)
    await rowMenu(page, plugin('greeter@seal-mkt'), 'Uninstall (Account)…')
    await confirmDialog(page, 'Uninstall')
    await expect(plugin('greeter@seal-mkt')).toHaveCount(0, { timeout: 120_000 })
  } else {
    await expect(output).toContainText(`claude-shim: plugin marketplace add ${marketplace}`)
    await shot(`${target.key}-6-plugins-and-marketplaces`)
  }
}

/** The settings form: permissions, model, hooks, with secrets hidden and unknown keys kept. */
export async function manageSettings(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  const settings = await openTab(panel, 'settings')
  const file = (...keys: string[]): unknown =>
    jsonOnMachine(target, '.claude/settings.json', ...keys)
  await expect(settings.locator('[data-agent-config-env="ANTHROPIC_API_KEY"] input')).toHaveValue(
    MASK
  )
  await expectNoSecretsOnPage(page)

  const allow = settings.getByRole('textbox', { name: 'Allow', exact: true })
  await allow.fill('Bash(ls:*)')
  await allow.press('Enter')
  await expect
    .poll(() => file('permissions', 'allow'))
    .toEqual(['Bash(git status:*)', 'Read', 'Bash(ls:*)'])

  await chooseOption(page, settings.getByRole('combobox', { name: 'Default mode' }), 'plan')
  await expect.poll(() => file('permissions', 'defaultMode')).toBe('plan')

  const model = settings.getByRole('textbox', { name: 'Model', exact: true })
  await model.fill('opus')
  await model.press('Enter')
  await expect.poll(() => file('model')).toBe('opus')

  await settings.getByRole('textbox', { name: 'Hook command' }).fill('echo edited')
  await settings.getByRole('textbox', { name: 'Hook command' }).press('Enter')
  await expect
    .poll(() => file('hooks', 'PostToolUse'))
    .toEqual([{ hooks: [{ type: 'command', command: 'echo edited' }] }])
  await shot(`${target.key}-7-settings-permissions-and-hooks`)

  expect(file('env')).toEqual({ ANTHROPIC_API_KEY: 'anthropic-secret-3', EDITOR: 'vim' })
  expect(file('someFutureSetting')).toEqual({ keep: ['me'] })
  expect(file('hooks', 'Stop')).toEqual([
    { hooks: [{ type: 'command', command: 'notify-send done' }] }
  ])
  expect(file('statusLine')).toEqual({ type: 'command', command: '~/.claude/statusline.sh' })
}

/** Files & backups: the raw editor hides secrets, and a backup brings a file back. */
export async function restoreFromBackups(env: JourneyEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  const files = await openTab(panel, 'files')
  await expect(files.locator('[data-agent-config-explorer]')).toContainText('skills', {
    timeout: 30_000
  })

  // The raw file is the fallback for everything, and still never shows a stored secret.
  await files
    .locator('[data-agent-config-file]')
    .filter({ hasText: '.claude.json' })
    .first()
    .click()
  await expect(editorSheet(page).locator('.monaco-editor').first()).toContainText('mcpServers', {
    timeout: 30_000
  })
  await expect(editorSheet(page).locator('.monaco-editor').first()).toContainText(MASK)
  await expectNoSecretsOnPage(page)
  await shot(`${target.key}-8-raw-file-with-secrets-hidden`)
  await closeEditor(page)

  // The newest backup of settings.json is the file as it was before the hook was added.
  const backup = files
    .locator(`[data-agent-config-backup="${target.home}/.claude/settings.json"]`)
    .first()
  await backup.scrollIntoViewIfNeeded()
  await shot(`${target.key}-9-files-and-backups`)
  await backup.getByRole('button', { name: 'Restore', exact: true }).click()
  await confirmDialog(page, 'Restore')
  await expect
    .poll(() => jsonOnMachine(target, '.claude/settings.json', 'hooks', 'PostToolUse'))
    .toBeUndefined()
  expect(jsonOnMachine(target, '.claude/settings.json', 'model')).toBe('opus')
}
