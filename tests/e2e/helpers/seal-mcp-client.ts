// A real MCP client on `seal mcp`, with a token minted in Settings > MCP.
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ElectronApplication, Locator, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'

export async function openMcpSettings(page: Page): Promise<Locator> {
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

/** Adds a client that may read and do what `scopes` name, and returns the token the app shows once. */
export async function addMcpClient(
  page: Page,
  settings: Locator,
  name: string,
  scopes: readonly ('Sessions' | 'Files' | 'Commands' | 'Destructive')[]
): Promise<string> {
  await settings.getByRole('button', { name: 'Add client' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(name)
  for (const scope of scopes) {
    await dialog.getByLabel(scope, { exact: true }).check()
  }
  await dialog.getByRole('button', { name: 'Create client' }).click()
  const shown = page.locator('[data-seal-mcp-token]')
  await expect(shown).toHaveText(/^smcp_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/)
  const token = await shown.innerText()
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  await expect(shown).toBeHidden()
  return token
}

export async function connectMcpOverStdio(
  app: ElectronApplication,
  token: string
): Promise<Client> {
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
