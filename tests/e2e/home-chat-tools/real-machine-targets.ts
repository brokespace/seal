import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { userInfo } from 'node:os'
import {
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@stablyai/playwright-test'
import { startHomeChatToolDriver } from '../helpers/home-chat-tool-driver'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from '../helpers/headless-paired-runtime-host'
import { startLocalSshdMachines, type LocalSshdUser } from '../helpers/local-sshd-machines'
import { forwardElectronProcessLogs } from '../helpers/orca-app'
import { createRestartSession } from '../helpers/orca-restart'
import { waitForSessionReady } from '../helpers/store'
import type { MachineId } from '../../../src/shared/machines/machine-types'
import type { Target, TargetKey, ToolEnv } from './tool-case-types'

const SSH_ACCOUNTS: { key: TargetKey; username: string; loginShell: string; label: string }[] = [
  { key: 'ssh-zsh', username: 'sealzsh', loginShell: '/bin/zsh', label: 'zsh-box' },
  { key: 'ssh-bash', username: 'sealbash', loginShell: '/bin/bash', label: 'bash-box' },
  { key: 'ssh-fish', username: 'sealfish', loginShell: '/usr/bin/fish', label: 'fish-box' }
]
const SERVER_LABEL = 'seal-server-box'
// The app and the Seal server both run with zsh as the login shell, as on macOS.
const APP_LOGIN_SHELL = '/bin/zsh'

export const WEB_PAGE_TITLE = 'Seal tool test page'
export const WEB_PAGE_SENTENCE = 'The quick brown seal reads this page over HTTP.'
export const WEB_SEARCH_RESULT = {
  title: 'Seal harbour notes',
  url: 'https://example.invalid/harbour',
  content: 'Harbour seals haul out at low tide.'
}

function shellAs(home: string): Target['sh'] {
  return (script, stdin) =>
    execFileSync('/bin/sh', ['-c', script], {
      input: stdin ?? '',
      env: { ...process.env, HOME: home },
      cwd: home,
      maxBuffer: 64 * 1024 * 1024
    })
}

/** Each login shell reads a different startup file; all of them export the same marker. */
function writeLoginProfile(target: Target): void {
  const marker = `SEAL_E2E_PROFILE=profile-of-${target.key}`
  if (target.loginShell.endsWith('fish')) {
    target.sh(
      'mkdir -p ~/.config/fish && cat >> ~/.config/fish/config.fish',
      `set -gx ${marker.replace('=', ' ')}\n`
    )
    return
  }
  const file = target.loginShell.endsWith('zsh') ? '~/.zprofile' : '~/.profile'
  target.sh(`cat >> ${file}`, `export ${marker}\n`)
}

async function startFakeWeb(): Promise<{ server: Server; origin: string; searches: string[] }> {
  const searches: string[] = []
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === '/search') {
      searches.push(url.searchParams.get('q') ?? '')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ results: [WEB_SEARCH_RESULT] }))
      return
    }
    if (url.pathname === '/missing') {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><p>Nothing here.</p></body></html>')
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<html><head><title>${WEB_PAGE_TITLE}</title></head><body><p>${WEB_PAGE_SENTENCE}</p></body></html>`
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a TCP listener's address is an AddressInfo.
  const { port } = server.address() as AddressInfo
  return { server, origin: `http://127.0.0.1:${port}`, searches }
}

type MachineRow = { id: MachineId; name: string; ssh: boolean; server: boolean }

async function listMachineRows(page: Page): Promise<MachineRow[]> {
  return page.evaluate(async () =>
    (await window.api.machines!.list()).map((machine) => ({
      id: machine.id,
      name: machine.name,
      ssh: machine.ssh !== null,
      server: machine.server !== null
    }))
  )
}

/** All targets are one host, so Seal merges an SSH entry with the server; the suite needs them apart. */
async function keepMachinesSeparate(page: Page, expected: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const rows = await listMachineRows(page)
        const merged = rows.filter((row) => row.ssh && row.server)
        for (const row of merged) {
          await page.evaluate((machineId) => window.api.machines!.separate({ machineId }), row.id)
        }
        return { merged: merged.length, machines: rows.length }
      },
      { timeout: 60_000 }
    )
    .toEqual({ merged: 0, machines: expected })
}

async function waitUntilOnline(page: Page, labels: readonly string[]): Promise<void> {
  await expect
    .poll(
      async () => {
        const machines = await page.evaluate(() => window.api.homeChat!.listMachines())
        return labels.filter(
          (label) => machines.find((machine) => machine.label === label)?.status !== 'online'
        )
      },
      { timeout: 120_000, message: 'machines still not online' }
    )
    .toEqual([])
}

export type RealMachineSuite = {
  env: ToolEnv
  /** The paired Seal server, for setting up what lives on it (its projects). */
  server: HeadlessPairedRuntimeHost
  dispose: () => Promise<void>
}

/**
 * The real app with the assistant pointed at a scripted model, plus the machines it works on:
 * this computer, three accounts behind a real sshd (zsh, bash, fish) and a paired Seal server.
 */
export async function launchHomeChatOnRealMachines(
  testInfo: TestInfo,
  projectPath: string
): Promise<RealMachineSuite> {
  const cleanups: (() => Promise<void> | void)[] = []
  const dispose = async (): Promise<void> => {
    for (const cleanup of cleanups.toReversed()) {
      await Promise.resolve()
        .then(cleanup)
        .catch((error: unknown) => console.warn('[home-chat-tools] cleanup failed:', error))
    }
  }
  try {
    const driver = await startHomeChatToolDriver()
    cleanups.push(() => driver.close())
    const web = await startFakeWeb()
    cleanups.push(() => void web.server.close())
    const sshd = await startLocalSshdMachines(SSH_ACCOUNTS)
    cleanups.push(() => sshd.dispose())
    // The agent lets this computer and the Seal server log in to the accounts, as a user's key would.
    const appEnv = { SHELL: APP_LOGIN_SHELL, SSH_AUTH_SOCK: sshd.agentSocket }
    const host = await launchHeadlessPairedRuntimeHost({ extraEnv: appEnv })
    cleanups.push(() => host.dispose())
    const session = createRestartSession(testInfo, appEnv)
    let app: ElectronApplication | undefined
    cleanups.push(() => session.dispose(app))
    const launched = await session.launch()
    app = launched.app
    forwardElectronProcessLogs(app, testInfo)
    const { page } = launched
    await waitForSessionReady(page)
    await page.evaluate((path) => window.api.repos.add({ path, kind: 'git' }), projectPath)

    await page.evaluate(
      async ({ baseUrl, searxngUrl }) => {
        await window.api.homeChat!.updateSettings({
          defaultBackend: 'openai-compatible',
          openai: { baseUrl, model: 'scripted-model', contextWindow: 400_000 },
          web: { searchProvider: 'searxng', searxngUrl }
        })
      },
      { baseUrl: driver.model.baseUrl, searxngUrl: web.origin }
    )

    await page.evaluate(
      async ({ name, pairingCode }) => {
        await window.api.runtimeEnvironments.addFromPairingCode({ name, pairingCode })
        const store = window.__store!.getState()
        store.setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
      },
      { name: SERVER_LABEL, pairingCode: host.offer.pairingUrl }
    )
    for (const account of SSH_ACCOUNTS) {
      await page.evaluate(
        // Connecting is left to the Machines list, which sets these up as plain SSH machines.
        (target) => window.api.ssh.addTarget({ target }),
        {
          label: account.label,
          host: sshd.host,
          port: sshd.port,
          username: account.username,
          identityFile: sshd.identityFile,
          identitiesOnly: true,
          relayGracePeriodSeconds: 1
        }
      )
    }
    const labels = [...SSH_ACCOUNTS.map((account) => account.label), SERVER_LABEL]
    await keepMachinesSeparate(page, labels.length)
    for (const row of await listMachineRows(page)) {
      await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), row.id)
    }
    await waitUntilOnline(page, labels)

    const localHome = await app.evaluate(({ app: electronApp }) => electronApp.getPath('home'))
    const listed = await page.evaluate(() => window.api.homeChat!.listMachines())
    const idOf = (label: string): string =>
      listed.find((machine) => machine.label === label)?.id ?? ''
    const localLabel = listed.find((machine) => machine.id === 'local')?.label
    const serverHome = host.env.HOME
    if (!serverHome) {
      throw new Error('The Seal server launched without an isolated HOME')
    }
    const sshUser = (username: string): LocalSshdUser =>
      sshd.users.find((user) => user.username === username)!
    const targets: Target[] = [
      {
        key: 'local',
        username: userInfo().username,
        machine: 'local',
        label: localLabel ?? '',
        id: 'local',
        home: localHome,
        loginShell: APP_LOGIN_SHELL,
        sh: shellAs(localHome)
      },
      ...SSH_ACCOUNTS.map((account): Target => {
        const user = sshUser(account.username)
        return {
          key: account.key,
          username: account.username,
          machine: account.label,
          label: account.label,
          id: idOf(account.label),
          home: user.home,
          loginShell: account.loginShell,
          sh: user.sh
        }
      }),
      {
        key: 'seal-server',
        username: userInfo().username,
        machine: SERVER_LABEL,
        label: SERVER_LABEL,
        id: idOf(SERVER_LABEL),
        home: serverHome,
        loginShell: APP_LOGIN_SHELL,
        sh: shellAs(serverHome)
      }
    ]
    targets.forEach(writeLoginProfile)

    return {
      dispose,
      server: host,
      env: {
        app,
        page,
        targets,
        projectPath,
        script: (steps) => driver.script(steps),
        web: {
          searchUrl: web.origin,
          pageUrl: `${web.origin}/page`,
          missingUrl: `${web.origin}/missing`,
          searches: web.searches
        },
        sshd: { host: sshd.host, port: sshd.port },
        call: (steps, options) => driver.run(page, steps, options)
      }
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
