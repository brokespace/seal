import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from '../helpers/orca-app'

export type AgentConfigTab = 'documents' | 'mcp' | 'plugins' | 'settings' | 'effective' | 'files'

/** Screenshots land where the run asks, so a verification run can keep them. */
export function screenshotter(page: Page, testInfo: TestInfo): (name: string) => Promise<void> {
  const dir = process.env.SEAL_AGENT_CONFIG_SHOTS_DIR ?? testInfo.outputPath('shots')
  mkdirSync(dir, { recursive: true })
  return async (name) => {
    // A hidden window draws no frames, so a transition would be caught at its first one.
    await page.screenshot({ path: path.join(dir, `${name}.png`), animations: 'disabled' })
  }
}

async function choose(page: Page, trigger: Locator, option: string | RegExp): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: option }).click()
}

/** Settings > Agent configuration, on one machine. */
export async function openMachineAgentConfig(page: Page, machineLabel: string): Promise<Locator> {
  await page.evaluate(() => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'agent-config', repoId: null })
    state.openSettingsPage()
  })
  const section = page.locator('section[data-settings-section="agent-config"]')
  await expect(section).toBeVisible({ timeout: 30_000 })
  await choose(page, section.locator('[data-agent-config-machine]'), machineLabel)
  await expect(section.locator('[data-agent-config-section="documents"]')).toBeVisible({
    timeout: 60_000
  })
  return section
}

/** A project's settings page, scrolled to its agent configuration. */
export async function openProjectAgentConfig(page: Page, repoId: string): Promise<Locator> {
  await page.evaluate((id) => {
    const state = window.__store!.getState()
    state.openSettingsTarget({ pane: 'repo', repoId: id })
    state.openSettingsPage()
  }, repoId)
  const panel = page.locator(`[data-agent-config-project="${repoId}"]`)
  await expect(panel.locator('[data-agent-config-section="documents"]')).toBeVisible({
    timeout: 60_000
  })
  await panel.scrollIntoViewIfNeeded()
  return panel
}

export async function chooseAgent(
  page: Page,
  panel: Locator,
  agent: { id: string; label: string }
): Promise<void> {
  await choose(page, panel.getByRole('combobox', { name: 'Agent' }), agent.label)
  await expect(panel.locator(`[data-agent-config-panel="${agent.id}"]`)).toBeVisible()
}

export async function openTab(panel: Locator, tab: AgentConfigTab): Promise<Locator> {
  await panel.locator(`[data-agent-config-tab="${tab}"]`).click()
  const section = panel.locator(`[data-agent-config-section="${tab}"]`)
  await expect(section).toBeVisible({ timeout: 30_000 })
  return section
}

export async function rowMenu(page: Page, row: Locator, item: string): Promise<void> {
  await row.getByRole('button', { name: /^Actions for / }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Answers a one-field prompt: a name (new, duplicate, rename) or a marketplace source. */
export async function answerPrompt(
  page: Page,
  value: string,
  confirm: string,
  field = '#agent-config-doc-name'
): Promise<void> {
  const dialog = page.getByRole('dialog').filter({ has: page.locator(field) })
  await dialog.locator(field).fill(value)
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 30_000 })
}

export async function confirmDialog(page: Page, confirm: string): Promise<void> {
  const dialog = page.locator('[data-agent-config-confirm]')
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(dialog).toBeHidden({ timeout: 60_000 })
}

/** The editor sheet that every file opens in. */
export function editorSheet(page: Page): Locator {
  return page.locator('[data-agent-config-editor]')
}

/** Replaces the whole file in the open editor, the way a paste would. */
export async function replaceEditorText(page: Page, text: string): Promise<void> {
  const sheet = editorSheet(page)
  await sheet.locator('.monaco-editor .view-lines').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
}

export async function saveEditor(page: Page): Promise<void> {
  const sheet = editorSheet(page)
  const save = sheet.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  // Saved means the editor holds what the machine holds again.
  await expect(save).toBeDisabled({ timeout: 30_000 })
  await expect(sheet.getByRole('alert')).toHaveCount(0)
}

export async function closeEditor(page: Page): Promise<void> {
  // Escape belongs to the editor while it has focus; the sheet's own button always closes it.
  await editorSheet(page).getByRole('button', { name: 'Close', exact: true }).click()
  await expect(editorSheet(page)).toBeHidden()
}

export { choose as chooseOption }
