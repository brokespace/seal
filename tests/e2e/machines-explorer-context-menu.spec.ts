import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@stablyai/playwright-test'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { localSshdUnavailableReason, startLocalSshdMachines } from './helpers/local-sshd-machines'
import { connectRemoteMachines, listMachines, selectMachine } from './helpers/machines-page'
import { createRestartSession } from './helpers/orca-restart'
import { seedIsolatedSshConfig } from './helpers/ssh-config-host-picker'
import { waitForSessionReady } from './helpers/store'
import type { MachineId } from '../../src/shared/machines/machine-types'

const SSH_ALIAS = 'seal-e2e-menu-box'
const SSH_USER = 'sealmenu'

async function showMachine(page: Page, machineId: MachineId): Promise<void> {
  await selectMachine(page, machineId)
  await expect(
    page.locator(`[data-machine-explorer="${machineId}"] [role=treeitem]`).first()
  ).toBeVisible({ timeout: 120_000 })
}

function row(page: Page, name: string) {
  return page.locator('[role=treeitem]', { hasText: name }).first()
}

async function chooseRowAction(page: Page, name: string, action: string): Promise<void> {
  await row(page, name).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function submitPrompt(page: Page, values: string[], confirm: string): Promise<void> {
  const dialog = page.getByRole('dialog')
  const fields = dialog.getByRole('textbox')
  for (const [index, value] of values.entries()) {
    await fields.nth(index).fill(value)
  }
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  await expect(dialog).toBeHidden()
}

async function readClipboard(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ clipboard }) => clipboard.readText())
}

/** Every native open dialog answers with `paths`, as if the user picked them. */
async function answerOpenDialogs(app: ElectronApplication, paths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, filePaths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
  }, paths)
}

async function startFileServer(body: string): Promise<{ url: string; server: Server }> {
  const server = createServer((_request, response) => response.end(body))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { url: `http://127.0.0.1:${port}/fetched.txt`, server }
}

test.skip(localSshdUnavailableReason() !== null, localSshdUnavailableReason() ?? '')

test('every file context-menu action works on local, Seal-server and SSH machines', async (// oxlint-disable-next-line no-empty-pattern -- This test owns the app launch: it needs the sshd agent socket.
{}, testInfo) => {
  // Starts an sshd, a paired Seal server and the app, then connects both transports.
  test.setTimeout(10 * 60_000)
  const sshd = await startLocalSshdMachines([{ username: SSH_USER, loginShell: '/bin/bash' }])
  const appEnv = { SSH_AUTH_SOCK: sshd.agentSocket }
  const host = await launchHeadlessPairedRuntimeHost({ extraEnv: appEnv })
  const session = createRestartSession(testInfo, appEnv)
  const { app, page } = await session.launch()
  const fileServer = await startFileServer('fetched by the machine\n')
  const scratch = mkdtempSync(path.join(tmpdir(), 'seal-machine-menu-'))
  try {
    const sshHome = sshd.users[0]!.home
    const serverHome = host.env.HOME!
    sshd.users[0]!.sh('printf "ssh notes\\n" > ~/ssh-notes.txt')
    writeFileSync(path.join(serverHome, 'server-notes.txt'), 'served by seal\n')
    const localHome = await seedIsolatedSshConfig(
      app,
      [
        `Host ${SSH_ALIAS}`,
        `  HostName ${sshd.host}`,
        `  Port ${sshd.port}`,
        `  User ${SSH_USER}`,
        `  IdentityFile ${sshd.identityFile}`,
        '  IdentitiesOnly yes',
        '  StrictHostKeyChecking no',
        '  UserKnownHostsFile /dev/null',
        ''
      ].join('\n')
    )
    writeFileSync(path.join(localHome, 'local-notes.txt'), 'local notes\n')
    mkdirSync(path.join(localHome, 'docs'))
    writeFileSync(path.join(localHome, 'docs', 'inside.txt'), 'inside\n')
    await waitForSessionReady(page)
    await page.evaluate(async (pairingCode) => {
      const state = window.__store!.getState()
      await window.api.runtimeEnvironments.addFromPairingCode({ name: 'server-box', pairingCode })
      state.setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
      state.setActiveView('machines')
    }, host.offer.pairingUrl)
    await page.waitForSelector('[data-machines-page]')

    await test.step('this computer: copy, preview, open, create, rename, transfer, delete', async () => {
      await showMachine(page, 'local')
      await chooseRowAction(page, 'local-notes.txt', 'Copy path')
      await expect.poll(() => readClipboard(app)).toBe(path.join(localHome, 'local-notes.txt'))

      await chooseRowAction(page, 'local-notes.txt', 'Preview')
      await expect(page.locator('[data-machine-explorer="local"] .monaco-editor')).toContainText(
        'local notes',
        { timeout: 30_000 }
      )

      await chooseRowAction(page, 'local-notes.txt', 'New folder…')
      await submitPrompt(page, ['made-by-menu'], 'Create')
      await expect.poll(() => existsSync(path.join(localHome, 'made-by-menu'))).toBe(true)

      await chooseRowAction(page, 'local-notes.txt', 'Rename…')
      await submitPrompt(page, ['renamed-notes.txt'], 'Rename')
      await expect.poll(() => existsSync(path.join(localHome, 'renamed-notes.txt'))).toBe(true)

      const downloads = path.join(scratch, 'downloads')
      mkdirSync(downloads)
      await answerOpenDialogs(app, [downloads])
      await chooseRowAction(page, 'renamed-notes.txt', 'Download to this computer…')
      await expect
        .poll(() => existsSync(path.join(downloads, 'renamed-notes.txt')), { timeout: 30_000 })
        .toBe(true)

      const upload = path.join(scratch, 'uploaded.txt')
      writeFileSync(upload, 'uploaded\n')
      await answerOpenDialogs(app, [upload])
      await chooseRowAction(page, 'renamed-notes.txt', 'Upload files…')
      await expect
        .poll(() => existsSync(path.join(localHome, 'uploaded.txt')), { timeout: 30_000 })
        .toBe(true)

      await chooseRowAction(page, 'renamed-notes.txt', 'Delete…')
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
      await expect.poll(() => existsSync(path.join(localHome, 'renamed-notes.txt'))).toBe(false)

      await chooseRowAction(page, 'docs', 'Open folder')
      await expect(row(page, 'inside.txt')).toBeVisible()
    })

    await connectRemoteMachines(page)
    const serverOnly = (await listMachines(page)).find((machine) => machine.server)!

    await test.step('a Seal-server machine copies its own path and fetches URLs itself', async () => {
      await showMachine(page, serverOnly.id)
      await chooseRowAction(page, 'server-notes.txt', 'Copy path')
      await expect.poll(() => readClipboard(app)).toBe(path.join(serverHome, 'server-notes.txt'))

      await chooseRowAction(page, 'server-notes.txt', 'Download from URL…')
      await submitPrompt(page, [fileServer.url, 'from-url.txt'], 'Download')
      await expect
        .poll(() => existsSync(path.join(serverHome, 'from-url.txt')), { timeout: 60_000 })
        .toBe(true)
      expect(readFileSync(path.join(serverHome, 'from-url.txt'), 'utf8')).toBe(
        'fetched by the machine\n'
      )
    })

    await page.evaluate(
      (alias) =>
        window.api.ssh.addTarget({
          target: {
            label: alias,
            configHost: alias,
            host: alias,
            port: 22,
            username: '',
            source: 'ssh-config'
          }
        }),
      SSH_ALIAS
    )
    await connectRemoteMachines(page)
    // One host reached both ways is recognised as a single machine once both connect.
    await expect
      .poll(async () => (await listMachines(page)).filter((m) => m.ssh && m.server).length, {
        timeout: 180_000
      })
      .toBe(1)
    const merged = (await listMachines(page)).find((machine) => machine.ssh && machine.server)!

    await test.step('a machine connected over SSH copies the remote path', async () => {
      await showMachine(page, merged.id)
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Connect over SSH instead' }).click()
      await expect(page.locator('[data-machine-open-editor]')).toBeEnabled({ timeout: 120_000 })
      await page.getByRole('button', { name: 'Home folder' }).click()
      await chooseRowAction(page, 'ssh-notes.txt', 'Copy path')
      await expect.poll(() => readClipboard(app)).toBe(`${sshHome}/ssh-notes.txt`)
    })
  } finally {
    await session.dispose(app)
    await host.dispose()
    sshd.dispose()
    fileServer.server.close()
    rmSync(scratch, { recursive: true, force: true })
  }
})
