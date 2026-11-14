import type { Locator, Page } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'
import type { Target } from '../home-chat-tools/tool-case-types'
import { jsonOnMachine, readOnMachine } from './agent-config-machine-seed'
import { chooseAgent, closeEditor, editorSheet, openTab, rowMenu } from './agent-config-page-driver'

type SkillsEnv = { page: Page; target: Target; shot: (name: string) => Promise<void> }

function skillGroups(docs: Locator): {
  group: (key: string) => Locator
  names: (key: string) => Promise<string[]>
} {
  const group = (key: string): Locator => docs.locator(`[data-agent-config-skill-group="${key}"]`)
  return {
    group,
    names: (key) =>
      group(key)
        .locator('[data-agent-config-doc]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-agent-config-doc') ?? ''))
  }
}

/** Claude Code's page: the account's skills, linked ones, and each plugin's own. */
async function claudeSkills(env: SkillsEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  await chooseAgent(page, panel, { id: 'claude', label: 'Claude Code' })
  const docs = await openTab(panel, 'documents')
  const { group, names } = skillGroups(docs)
  const account = 'user:.claude/skills'
  const hello = 'plugin:hello@local-mkt:1.0.0'
  const documents = 'plugin:document-skills@anthropic-agent-skills:1780c5e5a552'

  await expect.poll(() => names(account)).toEqual(['Broken Skill', 'deploy-app', 'shared-kit'])
  await expect(group(account)).toContainText('Account skills')
  expect(await names(hello)).toEqual(['wave', 'greet'])
  await expect(group(hello)).toContainText('Plugin skills: hello')
  // The marketplace lists two of the repository's skills for this plugin; the third is not loaded.
  expect(await names(documents)).toEqual(['docx', 'pdf'])
  await expect(group(hello).locator('[data-agent-config-doc="greet"]')).toContainText(
    'Greets people by name.'
  )
  await expect(group(hello).locator('[data-agent-config-doc="greet"]')).toContainText(
    '~/.claude/plugins/cache/local-mkt/hello/1.0.0/skills/greet'
  )
  await docs.scrollIntoViewIfNeeded()
  await shot(`skills-${target.key}-1-claude-account-and-plugins`)

  // The account's settings switch deploy-app off; the page shows that and can undo it.
  const deploy = group(account).getByRole('switch', { name: 'Use deploy-app' })
  await expect(deploy).not.toBeChecked()
  await deploy.click()
  await expect(deploy).toBeChecked({ timeout: 30_000 })
  expect(jsonOnMachine(target, '.claude/settings.json', 'skillOverrides')).toEqual({
    'broken-skill': 'name-only'
  })
  await group(account).getByRole('switch', { name: 'Use shared-kit' }).click()
  await expect
    .poll(() => jsonOnMachine(target, '.claude/settings.json', 'skillOverrides', 'shared-kit'))
    .toBe('off')

  // A plugin's skill opens to read and cannot be saved over.
  await group(hello).locator('[data-agent-config-doc="greet"]').getByRole('button').first().click()
  await expect(editorSheet(page).locator('.monaco-editor .view-lines')).toContainText(
    'name: greet',
    { timeout: 30_000 }
  )
  await expect(editorSheet(page)).toContainText('Read-only')
  await expect(editorSheet(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
  await shot(`skills-${target.key}-2-plugin-skill-read-only`)
  await closeEditor(page)
  await group(hello)
    .locator('[data-agent-config-doc="greet"]')
    .getByRole('button', { name: /^Actions for / })
    .click()
  await expect(page.getByRole('menuitem', { name: 'Delete…' })).toHaveCount(0)
  await expect(page.getByRole('menuitem', { name: 'Copy to…' })).toBeVisible()
  await page.keyboard.press('Escape')

  // A plugin goes on and off as a whole.
  const plugin = group(hello).getByRole('switch', { name: 'Enable hello' })
  await expect(plugin).toBeChecked()
  await plugin.click()
  await expect(plugin).not.toBeChecked({ timeout: 30_000 })
  await expect(group(hello)).toContainText('the plugin is off')
  expect(jsonOnMachine(target, '.claude/settings.json', 'enabledPlugins', 'hello@local-mkt')).toBe(
    false
  )
  await plugin.click()
  await expect(plugin).toBeChecked({ timeout: 30_000 })
}

/** Codex's page: grouped and linked folders, built-ins, and its plugin cache. */
async function codexSkills(env: SkillsEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  await chooseAgent(page, panel, { id: 'codex', label: 'Codex' })
  const docs = await openTab(panel, 'documents')
  const { group, names } = skillGroups(docs)

  await expect.poll(() => names('user:.codex/skills')).toEqual(['rollback', 'triage'])
  expect(await names('user:.agents/skills')).toEqual(['notes', 'shared-kit'])
  expect(await names('plugin:toolkit@openai-curated:1.2.0')).toEqual(['build', 'deploy'])
  expect(await names('plugin:paused@openai-curated:0.3.0')).toEqual(['idle'])
  expect(await names('builtin')).toEqual(['imagegen'])
  await expect(group('builtin')).toContainText('Built-in skills')
  await expect(group('plugin:paused@openai-curated:0.3.0')).toContainText('the plugin is off')
  await expect(
    group('user:.codex/skills').locator('[data-agent-config-doc="rollback"]')
  ).toContainText('~/.codex/skills/ops/rollback')
  await docs.scrollIntoViewIfNeeded()
  await shot(`skills-${target.key}-3-codex-folders-plugins-builtin`)

  const notes = group('user:.agents/skills').getByRole('switch', { name: 'Use notes' })
  await expect(notes).not.toBeChecked()
  const triage = group('user:.codex/skills').getByRole('switch', { name: 'Use triage' })
  await triage.click()
  await expect(triage).not.toBeChecked({ timeout: 30_000 })
  const toml = readOnMachine(target, '.codex/config.toml')
  expect(toml).toContain(
    `[[skills.config]]\npath = "${target.home}/.codex/skills/triage/SKILL.md"\nenabled = false\n`
  )
  expect(toml).toContain('# Codex settings\nmodel = "gpt-5" # the default\n')
  expect(target.sh('stat -c %a ~/.codex/config.toml').toString().trim()).toBe('600')

  // A linked skill is deleted as the link it is; what it points to stays.
  await rowMenu(
    page,
    group('user:.agents/skills').locator('[data-agent-config-doc="shared-kit"]'),
    'Delete…'
  )
  await page
    .locator('[data-agent-config-confirm]')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect.poll(() => names('user:.agents/skills')).toEqual(['notes'])
  target.sh(
    'test ! -e ~/.agents/skills/shared-kit && test -f ~/dotfiles/skills/shared-kit/SKILL.md'
  )
}

/** Cursor's page: its own folder, the ones it borrows, built-ins and unpacked plugins. */
async function cursorSkills(env: SkillsEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  await chooseAgent(page, panel, { id: 'cursor', label: 'Cursor' })
  const docs = await openTab(panel, 'documents')
  const { group, names } = skillGroups(docs)

  await expect.poll(() => names('user:.cursor/skills')).toEqual(['pr-review'])
  expect(await names('user:.claude/skills')).toEqual(['Broken Skill', 'deploy-app', 'shared-kit'])
  expect(await names('user:.codex/skills')).toEqual(['triage'])
  await expect(group('user:.claude/skills')).toContainText(
    'another agent’s folder that Cursor reads too'
  )
  expect(await names('builtin')).toEqual(['create-rule'])
  expect(await names('plugin:cursor-public/404:0.2.0')).toEqual(['find'])
  await expect(group('plugin:cursor-public/404:0.2.0')).toContainText(
    'Plugin skills: notion-workspace'
  )
  // Cursor has no switch for a skill or a plugin.
  await expect(docs.getByRole('switch')).toHaveCount(0)
  await docs.scrollIntoViewIfNeeded()
  await shot(`skills-${target.key}-4-cursor-own-borrowed-builtin-plugins`)
}

export async function manageSkills(env: SkillsEnv, panel: Locator): Promise<void> {
  await claudeSkills(env, panel)
  await codexSkills(env, panel)
  await cursorSkills(env, panel)
  await chooseAgent(env.page, panel, { id: 'claude', label: 'Claude Code' })
}

/** A project's page: its own skills first, then the account's and the plugins it runs with. */
export async function projectSkills(env: SkillsEnv, panel: Locator): Promise<void> {
  const { page, target, shot } = env
  const docs = await openTab(panel, 'documents')
  const { group, names } = skillGroups(docs)

  await expect.poll(() => names('project:.claude/skills')).toEqual(['lint-fix'])
  await expect(group('project:.claude/skills')).toContainText('Project skills')
  expect(await names('user:.claude/skills')).toContain('deploy-app')
  // Installed for this project only, so the machine's own page does not list it.
  expect(await names('plugin:other@local-mkt:1.0.0')).toEqual(['audit'])
  await expect(group('plugin:hello@local-mkt:1.0.0')).toContainText('the plugin is off')
  await group('project:.claude/skills').scrollIntoViewIfNeeded()
  await shot(`skills-${target.key}-5-project-claude`)

  // Switching an account skill from a project only changes this user's settings for the project.
  const broken = group('user:.claude/skills').getByRole('switch', { name: 'Use Broken Skill' })
  await broken.click()
  await expect(broken).not.toBeChecked({ timeout: 30_000 })
  expect(
    jsonOnMachine(target, 'work/app/.claude/settings.local.json', 'skillOverrides', 'broken-skill')
  ).toBe('off')

  await chooseAgent(page, panel, { id: 'codex', label: 'Codex' })
  const codex = skillGroups(await openTab(panel, 'documents'))
  await expect.poll(() => codex.names('project:.agents/skills')).toEqual(['repo-check'])
  expect(await codex.names('user:.codex/skills')).toEqual(['rollback', 'triage'])
  await codex.group('project:.agents/skills').scrollIntoViewIfNeeded()
  await shot(`skills-${target.key}-6-project-codex`)
  await chooseAgent(page, panel, { id: 'claude', label: 'Claude Code' })
}
