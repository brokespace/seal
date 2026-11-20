// Drives Settings > MCP and the approval prompt in the real app, with a real MCP client on `seal mcp`.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Locator } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { addMcpClient, connectMcpOverStdio, openMcpSettings } from './helpers/seal-mcp-client'

const CLIENT_NAME = 'Deploy assistant'

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
  const token = await addMcpClient(orcaPage, settings, CLIENT_NAME, ['Files', 'Destructive'])
  await expect(settings.getByText(CLIENT_NAME)).toBeVisible()
  const client = await connectMcpOverStdio(electronApp, token)
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
