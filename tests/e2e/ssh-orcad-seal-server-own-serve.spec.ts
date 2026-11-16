// On a machine whose user already runs `seal serve` as a service, an install Seal is asked for writes nothing,
// leaves that server running untouched, and offers to connect through it instead. A connect nobody confirmed
// an install for, by hand or when the app starts, puts no server on a host either. Needs Docker with cgroup v2
// and ORCA_E2E_ORCAD_CONVERT_TEMPLATE built for linux-x64-glibc.
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import {
  installOwnSealServe,
  ownSealServePairingLink
} from './helpers/docker-ssh-host-own-seal-serve'
import {
  dockerSystemdSshHostUnavailableReason,
  startDockerSystemdSshHost,
  type DockerSystemdSshHost
} from './helpers/docker-ssh-host-systemd-target'
import {
  addSshMachine,
  openMachinesPage,
  readMachine,
  sealServerFilesOnHost,
  showMachine
} from './helpers/seal-server-install-machine'
import {
  startUserRunSshPortForward,
  type UserRunSshPortForward
} from './helpers/user-run-ssh-port-forward'

const TEMPLATE = process.env.ORCA_E2E_ORCAD_CONVERT_TEMPLATE
const UNAVAILABLE = dockerSystemdSshHostUnavailableReason()
const MACHINE = 'seal-e2e-own-serve-box'
const PAIRED_SERVER = 'seal-e2e-own-tunnel-server'
const OWN_SERVE_PORT = 6768
// Where a server Seal installs as a service listens.
const SEAL_SERVICE_PORT = 16768
const HOST_ANSWER_TIMEOUT_MS = 60_000

test.skip(UNAVAILABLE !== null || !TEMPLATE, UNAVAILABLE ?? 'Set ORCA_E2E_ORCAD_CONVERT_TEMPLATE')

/** What a server Seal installs leaves on the host. */
function sealServerOnHost(host: DockerSystemdSshHost): Record<string, unknown> {
  return {
    installRoot: host.exec('test -e /home/seal/.orca-remote && echo yes || echo no'),
    sealServerFiles: sealServerFilesOnHost(host),
    sealServer: host.sealServerState(),
    sealServicePortListens: host
      .listeningSockets()
      .some((socket) => socket.port === SEAL_SERVICE_PORT)
  }
}

const NO_SEAL_SERVER = {
  installRoot: 'no',
  sealServerFiles: [],
  sealServer: { serviceActive: false, processIds: [] },
  sealServicePortListens: false
}

/** Everything an install or a restart of the user's server would change on the host. */
function hostServers(host: DockerSystemdSshHost): Record<string, unknown> {
  return {
    ...sealServerOnHost(host),
    ownServePid: host.loopbackListenerPid(OWN_SERVE_PORT),
    ownServeActive: host.userSystemctl(['is-active', 'seal-serve']).stdout,
    ownServeRestarts: host.userSystemctl(['show', 'seal-serve', '-p', 'NRestarts', '--value'])
      .stdout
  }
}

function untouched(ownServePid: number): Record<string, unknown> {
  return { ...NO_SEAL_SERVER, ownServePid, ownServeActive: 'active', ownServeRestarts: '0' }
}

async function ownServePid(host: DockerSystemdSshHost): Promise<number> {
  await expect
    .poll(() => host.loopbackListenerPid(OWN_SERVE_PORT), { timeout: HOST_ANSWER_TIMEOUT_MS })
    .not.toBeNull()
  return host.loopbackListenerPid(OWN_SERVE_PORT)!
}

/** The id the running `seal serve` gave itself; a server started again has another. */
function ownServeRuntimeId(host: DockerSystemdSshHost): string {
  const metadata: { runtimeId: string } = JSON.parse(
    host.exec('cat /home/seal/.config/Seal/orca-runtime.json')
  )
  return metadata.runtimeId
}

/** The runtime that answers the desktop through the machine's server, or null when none does. */
function answeringRuntime(page: Page, environmentId: string): Promise<string | null> {
  return page.evaluate(async (selector) => {
    const response = await window.api.runtimeEnvironments.call({
      selector,
      method: 'terminal.list',
      params: {}
    })
    return response.ok ? response._meta.runtimeId : null
  }, environmentId)
}

/** Whether main holds an open session for the SSH target, and the Seal server it reaches the host through. */
function sshSession(page: Page, targetId: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (id) => {
    const state = await window.api.ssh.getState({ targetId: id })
    return { status: state?.status ?? null, managedServer: state?.managedServer ?? null }
  }, targetId)
}

const PLAIN_SSH_SESSION = { status: 'connected', managedServer: null }

function savedServerIds(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await window.api.runtimeEnvironments.list()).map((server) => server.id)
  )
}

async function readReuseOffer(page: Page): Promise<Record<string, unknown> | null> {
  const machine = await readMachine(page, MACHINE)
  return machine
    ? {
        connection: machine.connection,
        serverInstallAction: machine.serverInstallAction,
        serverOwnServe: machine.serverOwnServe ?? null
      }
    : null
}

const REUSE_OFFER = {
  connection: 'ssh',
  serverInstallAction: 'reuse',
  serverOwnServe: { manager: 'systemd-user', name: 'seal-serve.service' }
}

async function confirmReuse(page: Page, screenshotPath?: string): Promise<void> {
  await page.locator('[data-machine-server="reuse"] [data-machine-server-action="reuse"]').click()
  const confirmation = page.getByRole('dialog').filter({ hasText: MACHINE })
  await expect(confirmation).toBeVisible()
  if (screenshotPath) {
    await page.screenshot({ path: screenshotPath, animations: 'disabled' })
  }
  await confirmation.getByRole('button', { name: 'Use this server', exact: true }).click()
  await expect(confirmation).toBeHidden()
}

test('an install asked for on a machine that runs its own seal serve installs nothing and offers that server', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and launches the app; the host's answer arrives over a fresh SSH login.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.installOwnServeService()
    const pid = await ownServePid(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)

    await test.step('a confirmed install writes nothing and leaves the running server alone', async () => {
      await addSshMachine(page, host.ssh, MACHINE, { installServer: true })
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })

    await test.step('the machine page offers the running server', async () => {
      await showMachine(page, MACHINE)
      const band = page.getByRole('region', { name: 'Seal server' })
      await expect(band).toHaveAttribute('data-machine-server', 'reuse')
      await expect(band).toContainText('seal-serve.service')
      await expect(band.locator('[data-machine-server-action="install"]')).toHaveCount(0)
      await page.screenshot({
        path: testInfo.outputPath('reuse-offer.png'),
        animations: 'disabled'
      })
    })

    await test.step('a server that gives no pairing link stays untouched and the user is told to pair by hand', async () => {
      await confirmReuse(page)
      await expect(
        page.locator('[data-sonner-toast]').filter({ hasText: 'seal pair' })
      ).toBeVisible({ timeout: HOST_ANSWER_TIMEOUT_MS })
      expect(await readReuseOffer(page)).toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server',
        'reuse'
      )
      await page.screenshot({
        path: testInfo.outputPath('reuse-pair-by-hand.png'),
        animations: 'disabled'
      })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})

test('a machine added without the install turns to the reuse offer once its SSH session is asked', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and launches the app; the host's answer arrives over a fresh SSH login.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    host.installOwnServeService()
    const pid = await ownServePid(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)
    await addSshMachine(page, host.ssh, MACHINE)
    const added = (await readMachine(page, MACHINE))!
    expect(added).toMatchObject({ connection: 'ssh', serverInstallAction: 'install' })

    await test.step('the open SSH session answers that the machine runs its own server', async () => {
      await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), added.id)
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      await showMachine(page, MACHINE)
      await expect(page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server',
        'reuse'
      )
    })

    await test.step('an install requested without the dialog installs nothing either', async () => {
      const answered = await page.evaluate(
        (machineId) => window.api.machines!.installServer({ machineId }),
        added.id
      )
      expect(answered).toMatchObject(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})

test('Use this server connects the machine through the seal serve its user runs', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host, unpacks and starts a real server on it, and launches the app twice.
  test.setTimeout(8 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  try {
    installOwnSealServe(host, TEMPLATE!)
    const pid = await ownServePid(host)
    const runtimeId = ownServeRuntimeId(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await openMachinesPage(page)

    await test.step('a confirmed install writes nothing and offers the running server', async () => {
      await addSshMachine(page, host.ssh, MACHINE, { installServer: true })
      await expect
        .poll(() => readReuseOffer(page), { timeout: HOST_ANSWER_TIMEOUT_MS })
        .toEqual(REUSE_OFFER)
      expect(hostServers(host)).toEqual(untouched(pid))
    })

    await test.step('confirming Use this server switches the machine to that server', async () => {
      await showMachine(page, MACHINE)
      await confirmReuse(page, testInfo.outputPath('reuse-confirmation.png'))
      await expect
        .poll(async () => (await readMachine(page, MACHINE))?.connection, {
          timeout: HOST_ANSWER_TIMEOUT_MS
        })
        .toBe('server')
    })

    await test.step('the desktop talks to the user’s server, which nothing replaced or restarted', async () => {
      const machine = (await readMachine(page, MACHINE))!
      expect(machine.serverInstall).toEqual({ policy: 'never', state: 'declined' })
      expect(await answeringRuntime(page, machine.server!.environmentId)).toBe(runtimeId)
      expect(hostServers(host)).toEqual(untouched(pid))
      const band = page.getByRole('region', { name: 'Seal server' })
      await expect(band).toHaveAttribute('data-machine-server-keeper', 'systemd-user')
      await expect(page.locator('[data-machine-server-action="remove"]')).toHaveCount(0)
      await page.screenshot({ path: testInfo.outputPath('reused.png'), animations: 'disabled' })
    })

    await session.close(app)
    app = null

    await test.step('after an app restart the machine reconnects through the same server', async () => {
      const relaunched = await session.launch()
      app = relaunched.app
      await waitForSessionReady(relaunched.page)
      const machine = (await readMachine(relaunched.page, MACHINE))!
      expect(machine.connection).toBe('server')
      await relaunched.page.evaluate(
        (machineId) => window.api.machines!.connect({ machineId }),
        machine.id
      )
      await expect
        .poll(() => answeringRuntime(relaunched.page, machine.server!.environmentId), {
          timeout: 3 * 60_000
        })
        .toBe(runtimeId)
      expect(hostServers(host)).toEqual(untouched(pid))
      await openMachinesPage(relaunched.page)
      await showMachine(relaunched.page, MACHINE)
      await expect(relaunched.page.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user'
      )
      await expect(relaunched.page.locator('[data-machine-server-action="remove"]')).toHaveCount(0)
      await relaunched.page.screenshot({
        path: testInfo.outputPath('reused-after-restart.png'),
        animations: 'disabled'
      })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})

test('a machine bound to the server this computer reaches through the user’s own tunnel gets no second server when the app restarts', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host, starts a real server on it, launches the app twice, and waits out the time in which a restart deployed.
  test.setTimeout(10 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo, { linger: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  let tunnel: UserRunSshPortForward | null = null
  try {
    installOwnSealServe(host, TEMPLATE!)
    const pid = await ownServePid(host)
    const runtimeId = ownServeRuntimeId(host)
    // The link `seal pair` prints names 127.0.0.1:6768, so that is the port the user forwards.
    tunnel = await startUserRunSshPortForward(host.ssh, OWN_SERVE_PORT)
    const pairingLink = ownSealServePairingLink(host)
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)

    const pairedId =
      await test.step('this computer pairs with the server through the user’s tunnel', async () => {
        // What Add machine > Connect via Seal server sends with "I am using an SSH tunnel" ticked.
        const paired = await page.evaluate(
          ({ name, pairingCode }) =>
            window.api.runtimeEnvironments.verifyAndAddFromPairingCode({
              name,
              pairingCode,
              allowLoopback: true
            }),
          { name: PAIRED_SERVER, pairingCode: pairingLink }
        )
        expect(paired).toMatchObject({
          ok: true,
          environment: { name: PAIRED_SERVER, connectionDependency: 'ssh-tunnel' }
        })
        const [id] = await savedServerIds(page)
        expect(await answeringRuntime(page, id)).toBe(runtimeId)
        return id
      })

    // Sent as the dialogs send them, with the Machines page closed: while it shows both machines it asks each
    // who it is, and two that name the same machine id are merged before the offered server can be chosen.
    const added =
      await test.step('the same host, saved over SSH with the install confirmed, offers the running server', async () => {
        const answered = await page.evaluate(
          async ({ ssh, label }) => {
            const { target } = await window.api.ssh.addTarget({
              target: {
                label,
                host: ssh.host,
                port: ssh.port,
                username: ssh.username,
                identityFile: ssh.identityFile,
                identitiesOnly: true
              }
            })
            const machine = (await window.api.machines!.list()).find(
              (view) => view.ssh?.targetId === target.id
            )!
            const view = await window.api.machines!.installServer({ machineId: machine.id })
            return {
              targetId: target.id,
              machineId: machine.id,
              offer: {
                connection: view.connection,
                serverInstallAction: view.serverInstallAction,
                serverOwnServe: view.serverOwnServe ?? null
              }
            }
          },
          { ssh: host.ssh, label: MACHINE }
        )
        expect(answered.offer).toEqual(REUSE_OFFER)
        expect(hostServers(host)).toEqual(untouched(pid))
        return answered
      })

    await test.step('Use this server binds the machine to the pairing this computer already has', async () => {
      const bound = await page.evaluate(
        (machineId) => window.api.machines!.reuseOwnServer({ machineId }),
        added.machineId
      )
      expect({ connection: bound.connection, server: bound.server?.environmentId }).toEqual({
        connection: 'server',
        server: pairedId
      })
      expect(await savedServerIds(page)).toEqual([pairedId])
      expect(hostServers(host)).toEqual(untouched(pid))
    })

    await session.close(app)
    app = null

    const relaunched = await session.launch()
    app = relaunched.app
    const restarted = relaunched.page
    await waitForSessionReady(restarted)

    await test.step('the restarted app connects the machine over SSH and puts no server on it', async () => {
      await expect
        .poll(() => sshSession(restarted, added.targetId), { timeout: 2 * 60_000 })
        .toEqual(PLAIN_SSH_SESSION)
      // ast-grep-ignore: test-no-real-time-wait -- a restart deployed a second server within 30 s of this connect, and a run that deploys none has no moment that says so
      await restarted.waitForTimeout(45_000)
      expect(await sshSession(restarted, added.targetId)).toEqual(PLAIN_SSH_SESSION)
      expect(hostServers(host)).toEqual(untouched(pid))
      expect(await savedServerIds(restarted)).toEqual([pairedId])
      expect(tunnel!.running()).toBe(true)
      await expect
        .poll(() => answeringRuntime(restarted, pairedId), { timeout: 60_000 })
        .toBe(runtimeId)
    })

    await test.step('the machine still connects through the user’s server', async () => {
      const machine = (await readMachine(restarted, MACHINE))!
      expect({ connection: machine.connection, server: machine.server?.environmentId }).toEqual({
        connection: 'server',
        server: pairedId
      })
      await openMachinesPage(restarted)
      await showMachine(restarted, MACHINE)
      await expect(restarted.getByRole('region', { name: 'Seal server' })).toHaveAttribute(
        'data-machine-server-keeper',
        'systemd-user',
        { timeout: HOST_ANSWER_TIMEOUT_MS }
      )
      await expect(restarted.locator('[data-machine-server-action="remove"]')).toHaveCount(0)
      await restarted.screenshot({
        path: testInfo.outputPath('own-tunnel-after-restart.png'),
        animations: 'disabled'
      })
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      tunnel?.stop()
      host.dispose()
    }
  }
})

test('an SSH target saved and connected with no install confirmed gets a plain session, and Settings’ install requests are refused', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app launch and its host.
{}, testInfo) => {
  // Boots a systemd host and launches the app; the connect is a fresh SSH login.
  test.setTimeout(5 * 60_000)
  const host = await startDockerSystemdSshHost(testInfo)
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: TEMPLATE! })
  let app: ElectronApplication | null = null
  const noServerOnHost = (): Record<string, unknown> => ({
    ...sealServerOnHost(host),
    // Where a server Seal deployed without a service listened.
    defaultPortPid: host.loopbackListenerPid(OWN_SERVE_PORT)
  })
  const NO_SERVER = { ...NO_SEAL_SERVER, defaultPortPid: null }
  try {
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)

    const targetId =
      await test.step('the connect that follows the save deploys nothing', async () => {
        // One round trip, so the machines are not listed between the save and the connect.
        const connected = await page.evaluate(
          async ({ ssh, label }) => {
            const { target } = await window.api.ssh.addTarget({
              target: {
                label,
                host: ssh.host,
                port: ssh.port,
                username: ssh.username,
                identityFile: ssh.identityFile,
                identitiesOnly: true
              }
            })
            const state = await window.api.ssh.connect({ targetId: target.id })
            return {
              targetId: target.id,
              session: {
                status: state?.status ?? null,
                managedServer: state?.managedServer ?? null
              }
            }
          },
          { ssh: host.ssh, label: MACHINE }
        )
        expect(connected.session).toEqual(PLAIN_SSH_SESSION)
        expect(noServerOnHost()).toEqual(NO_SERVER)
        return connected.targetId
      })

    await test.step('Settings’ two install requests are refused for a host with no confirmed install', async () => {
      const refusals = await page.evaluate(
        async ({ sshTargetId, name }) => {
          const servers = window.api.runtimeEnvironments.managedOrcad!
          const refusal = (request: Promise<unknown>): Promise<string> =>
            request.then(
              () => 'not refused',
              (error: unknown) => String(error)
            )
          return {
            deploy: await refusal(servers.deploy({ name, sshTargetId })),
            convert: await refusal(servers.convertSshHost({ sshTargetId, name }))
          }
        },
        { sshTargetId: targetId, name: MACHINE }
      )
      expect(refusals.deploy).toContain('Seal server is installed from the machine’s page')
      expect(refusals.convert).toContain('Seal server is installed from the machine’s page')
      expect(noServerOnHost()).toEqual(NO_SERVER)
      expect(await sshSession(page, targetId)).toEqual(PLAIN_SSH_SESSION)
      expect(await savedServerIds(page)).toEqual([])
      expect((await readMachine(page, MACHINE))?.connection).toBe('ssh')
    })
  } finally {
    try {
      await session.dispose(app ?? undefined)
    } finally {
      host.dispose()
    }
  }
})
