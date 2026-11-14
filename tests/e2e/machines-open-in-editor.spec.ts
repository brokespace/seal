import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@stablyai/playwright-test'
import { createFakeEditorClis, type FakeEditorClis } from './helpers/fake-editor-clis'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import { localSshdUnavailableReason, startLocalSshdMachines } from './helpers/local-sshd-machines'
import { createRestartSession } from './helpers/orca-restart'
import { seedIsolatedSshConfig } from './helpers/ssh-config-host-picker'
import { waitForSessionReady } from './helpers/store'
import type { MachineId } from '../../src/shared/machines/machine-types'

const SSH_ALIAS = 'seal-e2e-editor-box'
const SSH_USER = 'sealedit'
const OPEN_IN_APPLICATIONS = [
  { id: 'cursor', label: 'Cursor', command: 'cursor' },
  { id: 'vscode', label: 'VS Code', command: 'code' },
  { id: 'broken', label: 'Broken editor', command: 'seal-e2e-broken-editor' },
  { id: 'missing', label: 'Missing editor', command: 'seal-e2e-missing-editor' }
]

type MachineRow = { id: MachineId; ssh: boolean; server: boolean }

async function listMachines(page: Page): Promise<MachineRow[]> {
  return page.evaluate(async () =>
    (await window.api.machines!.list()).map((machine) => ({
      id: machine.id,
      ssh: machine.ssh !== null,
      server: machine.server !== null
    }))
  )
}

async function connectRemoteMachines(page: Page): Promise<void> {
  for (const machine of await listMachines(page)) {
    if (machine.id !== 'local') {
      await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), machine.id)
    }
  }
}

/** Selects the machine and waits until its files are listed. */
async function showMachine(page: Page, machineId: MachineId): Promise<string> {
  await page.locator(`[data-machines-page] [data-machine-id="${machineId}"]`).click()
  await expect(page.locator(`[data-machine-explorer="${machineId}"]`)).toBeVisible({
    timeout: 120_000
  })
  await expect(page.getByRole('button', { name: 'Open in editor' })).toBeEnabled()
  await expect(
    page.locator(`[data-machine-explorer="${machineId}"] [role=treeitem]`).first()
  ).toBeVisible({ timeout: 60_000 })
  return page.evaluate(
    async (id) => (await window.api.machines!.listDir({ machineId: id })).path,
    machineId
  )
}

async function chooseEditor(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Choose editor' }).click()
  await page.getByRole('menuitem', { name: label }).click()
}

async function chooseRowAction(page: Page, fileName: string, action: string): Promise<void> {
  await page.locator('[role=treeitem]', { hasText: fileName }).click({ button: 'right' })
  await page.getByRole('menuitem', { name: action, exact: true }).click()
}

async function expectLastLaunch(editors: FakeEditorClis, expected: string[]): Promise<void> {
  await expect.poll(() => editors.launches().at(-1), { timeout: 15_000 }).toEqual(expected)
}

test.skip(localSshdUnavailableReason() !== null, localSshdUnavailableReason() ?? '')

test('Open in editor reaches local, SSH and Seal-server machines, for folders and files', async (// oxlint-disable-next-line no-empty-pattern -- This test owns the app launch: it needs the fake editors on PATH.
{}, testInfo) => {
  // Starts an sshd, a paired Seal server and the app, then connects both transports.
  test.setTimeout(10 * 60_000)
  const editors = createFakeEditorClis(['code', 'cursor', 'seal-e2e-broken-editor'], {
    'seal-e2e-broken-editor': 3
  })
  const sshd = await startLocalSshdMachines([{ username: SSH_USER, loginShell: '/bin/bash' }])
  const appEnv = {
    SSH_AUTH_SOCK: sshd.agentSocket,
    PATH: `${editors.binDir}:${process.env.PATH}`
  }
  const host = await launchHeadlessPairedRuntimeHost({ extraEnv: appEnv })
  const session = createRestartSession(testInfo, appEnv)
  const { app, page } = await session.launch()
  try {
    const sshHome = sshd.users[0]!.home
    sshd.users[0]!.sh('mkdir -p ~/project && printf "ssh notes\\n" > ~/ssh-notes.txt')
    writeFileSync(path.join(host.env.HOME!, 'server-notes.txt'), 'served by seal\n')
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
    await waitForSessionReady(page)
    await page.evaluate(
      async ({ applications, pairingCode }) => {
        const state = window.__store!.getState()
        await state.updateSettings({ openInApplications: applications })
        await window.api.runtimeEnvironments.addFromPairingCode({
          name: 'server-box',
          pairingCode
        })
        state.setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
        state.setActiveView('machines')
      },
      { applications: OPEN_IN_APPLICATIONS, pairingCode: host.offer.pairingUrl }
    )
    await page.waitForSelector('[data-machines-page]')

    await test.step('this computer opens in the first Open In app, or the one picked', async () => {
      await showMachine(page, 'local')
      await page.getByRole('button', { name: 'Open in editor' }).click()
      await expectLastLaunch(editors, ['cursor', '--new-window', localHome])
      await chooseEditor(page, 'VS Code')
      await expectLastLaunch(editors, ['code', localHome])
      await chooseRowAction(page, 'local-notes.txt', 'Open in Cursor')
      await expectLastLaunch(editors, [
        'cursor',
        '--new-window',
        path.join(localHome, 'local-notes.txt')
      ])
    })

    await test.step('a launcher that is missing or fails says so', async () => {
      await chooseEditor(page, 'Missing editor')
      await expect(page.getByText('Could not open Missing editor')).toBeVisible()
      await expect(
        page.getByText('The “seal-e2e-missing-editor” command was not found on this computer.', {
          exact: false
        })
      ).toBeVisible()
      await chooseEditor(page, 'Broken editor')
      await expect(
        page.getByText(/seal-e2e-broken-editor” quit with exit code 3 before opening anything\./)
      ).toBeVisible()
    })

    await connectRemoteMachines(page)
    const serverOnly = (await listMachines(page)).find((machine) => machine.server)!

    await test.step('a Seal-server machine without SSH details opens in Seal’s editor', async () => {
      await showMachine(page, serverOnly.id)
      const launchesBefore = editors.launches().length
      await chooseRowAction(page, 'server-notes.txt', 'Open in editor')
      await expect(
        page.locator(`[data-machine-explorer="${serverOnly.id}"] .monaco-editor`)
      ).toContainText('served by seal', { timeout: 30_000 })
      await expect(page.getByText('Opened the file in Seal’s editor')).toBeVisible()

      await page.getByRole('button', { name: 'Open in editor' }).click()
      await expect(page.getByText('Showing the folder in Seal’s files')).toBeVisible()
      expect(editors.launches()).toHaveLength(launchesBefore)

      await expect(
        page
          .locator('[data-sonner-toast]', { hasText: 'Showing the folder in Seal’s files' })
          .getByRole('button', { name: 'Add SSH details…' })
      ).toBeVisible()
      await chooseEditor(page, 'Add SSH details…')
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
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

    await test.step('a Seal-server machine with SSH details opens over SSH', async () => {
      const folder = await showMachine(page, merged.id)
      await page.getByRole('button', { name: 'Open in editor' }).click()
      await expectLastLaunch(editors, [
        'cursor',
        '--new-window',
        '--remote',
        `ssh-remote+${SSH_ALIAS}`,
        folder
      ])
      await chooseEditor(page, 'VS Code')
      await expectLastLaunch(editors, ['code', '--remote', `ssh-remote+${SSH_ALIAS}`, folder])
    })

    await test.step('a machine connected over SSH opens its folders and files in the app', async () => {
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Connect over SSH instead' }).click()
      await expect(page.getByRole('button', { name: 'Open in editor' })).toBeEnabled({
        timeout: 120_000
      })
      await page.getByRole('button', { name: 'Home folder' }).click()
      await chooseRowAction(page, 'project', 'Open in Cursor')
      await expectLastLaunch(editors, [
        'cursor',
        '--new-window',
        '--remote',
        `ssh-remote+${SSH_ALIAS}`,
        `${sshHome}/project`
      ])
      await chooseRowAction(page, 'ssh-notes.txt', 'Open in Cursor')
      await expectLastLaunch(editors, [
        'cursor',
        '--new-window',
        '--remote',
        `ssh-remote+${SSH_ALIAS}`,
        `${sshHome}/ssh-notes.txt`
      ])
    })
  } finally {
    await session.dispose(app)
    await host.dispose()
    sshd.dispose()
    editors.dispose()
  }
})
