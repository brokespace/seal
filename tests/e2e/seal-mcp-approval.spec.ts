// Drives Settings > MCP and the approval prompt in the real app, with a real MCP client on `seal mcp`.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const CLIENT_NAME = 'Deploy assistant'

async function openMcpSettings(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    const state = window.__store?.getState()
    state?.openSettingsTarget({ pane: 'mcp', repoId: null })
    state?.openSettingsPage()
  })
  const settings = page.locator('[data-slot="seal-mcp-settings"]')
  await expect(settings.getByRole('button', { name: 'Add client' })).toBeVisible()
  return settings
}

/** Adds a client in Settings and returns the token the app shows once. */
async function addClient(page: Page, settings: Locator): Promise<string> {
  await settings.getByRole('button', { name: 'Add client' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(CLIENT_NAME)
  await dialog.getByLabel('Files', { exact: true }).check()
  await dialog.getByLabel('Destructive', { exact: true }).check()
  await dialog.getByRole('button', { name: 'Create client' }).click()
  const shown = page.locator('[data-seal-mcp-token]')
  await expect(shown).toHaveText(/^smcp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/)
  const token = await shown.innerText()
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  await expect(shown).toBeHidden()
  return token
}

async function connectOverStdio(app: ElectronApplication, token: string): Promise<Client> {
  const userDataDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  const client = new Client({ name: 'seal-e2e', version: '0.0.0' })
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [path.join(process.cwd(), 'out', 'cli', 'index.js'), 'mcp'],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        ),
        ORCA_USER_DATA_PATH: userDataDir,
        ORCA_DEV_CLI_INVOCATION: '1',
        SEAL_MCP_TOKEN: token
      }
    })
  )
  return client
}

/** Answers the prompt; Approve ignores presses for a moment after a request appears, so it is retried. */
async function answer(prompt: Locator, button: 'Approve' | 'Deny'): Promise<void> {
  await expect(async () => {
    await prompt.getByRole('button', { name: button }).click({ timeout: 5_000 })
    await expect(prompt).toBeHidden({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
}

test('an MCP client added in Settings has its destructive call held for an answer in the app', async ({
  electronApp,
  orcaPage
}) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'seal-mcp-e2e-'))
  const victim = path.join(scratch, 'build-output.txt')
  writeFileSync(victim, 'delete me')
  const settings = await openMcpSettings(orcaPage)
  const token = await addClient(orcaPage, settings)
  await expect(settings.getByText(CLIENT_NAME)).toBeVisible()
  const client = await connectOverStdio(electronApp, token)
  const prompt = orcaPage.locator('[data-seal-mcp-approval-prompt]')

  try {
    const tools = (await client.listTools()).tools.map((tool) => tool.name)
    expect(tools).toContain('delete_path')
    expect(tools).not.toContain('run_command')

    const refused = client.callTool({
      name: 'delete_path',
      arguments: { machine: 'local', path: victim }
    })
    await expect(prompt).toContainText(`${CLIENT_NAME} asks to run delete_path`)
    await expect(prompt).toContainText(victim)
    await answer(prompt, 'Deny')
    expect((await refused).isError).toBe(true)
    expect(existsSync(victim)).toBe(true)

    const allowed = client.callTool({
      name: 'delete_path',
      arguments: { machine: 'local', path: victim }
    })
    await expect(prompt).toContainText(`${CLIENT_NAME} asks to run delete_path`)
    await answer(prompt, 'Approve')
    expect((await allowed).isError).not.toBe(true)
    expect(existsSync(victim)).toBe(false)

    await expect(settings.getByText('Approved in the app')).toBeVisible()
    await expect(settings.getByText('Not approved')).toBeVisible()

    await settings.getByRole('button', { name: 'Revoke' }).click()
    await orcaPage.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
    await expect(settings.getByText('Revoked', { exact: true })).toBeVisible()
    await expect(client.listTools()).rejects.toThrow()
  } finally {
    await client.close().catch(() => undefined)
    rmSync(scratch, { recursive: true, force: true })
  }
})
