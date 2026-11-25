// A Docker SSH host with a stand-in `docker` CLI, connected as a machine on the Machines page.
// The stand-in keeps its state in a JSON file on the host, so a test can read what Seal changed.
import type { ElectronApplication, Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetControlCommand,
  startDockerSshHostTarget,
  type DockerSshHostTarget
} from './docker-ssh-host-target'
import { createRestartSession } from './orca-restart'
import { openMachinesPage, readMachine, showMachine } from './seal-server-install-machine'
import { waitForSessionReady } from './store'
import {
  FAKE_DOCKER_STATE_FILE,
  fakeDockerCliScript
} from '../../../src/main/machines/testing/fake-docker-cli'
import { fakeDockerState } from '../../../src/main/machines/testing/fake-docker-default-state'
import type { FakeDockerState } from '../../../src/main/machines/testing/fake-docker-state'

const BIN_DIR = '/usr/local/bin'
const STATE_PATH = `${BIN_DIR}/${FAKE_DOCKER_STATE_FILE}`

export type FakeDockerHost = {
  page: Page
  app: ElectronApplication
  label: string
  /** Puts `docker` on the host's PATH with this state, or replaces the state it has. */
  installDocker: (state?: FakeDockerState) => void
  readState: () => FakeDockerState
  /** Whether the host's own filesystem has this path. */
  hasPath: (path: string) => boolean
  /** Opens the panel a CPU, RAM or Disk meter opens. */
  openPanel: (kind: 'cpu' | 'memory' | 'disk') => Promise<Locator>
  shot: (name: string) => Promise<void>
  dispose: () => Promise<void>
}

function writeHostFile(target: DockerSshHostTarget, path: string, contents: string): void {
  const encoded = Buffer.from(contents).toString('base64')
  execDockerSshHostTargetControlCommand(target, `printf '%s' '${encoded}' | base64 -d > ${path}`)
}

/** Starts the host and the app, and connects the host over SSH. Docker is not installed yet. */
export async function launchFakeDockerHost(
  testInfo: TestInfo,
  label: string
): Promise<FakeDockerHost> {
  const target = startDockerSshHostTarget(testInfo)
  const session = createRestartSession(testInfo, {})
  let app: ElectronApplication | null = null
  const dispose = async (): Promise<void> => {
    await session.dispose(app ?? undefined)
    cleanupDockerSshHostTarget(target)
  }
  try {
    const launched = await session.launch()
    app = launched.app
    const { page } = launched
    await waitForSessionReady(page)
    await page.evaluate((input) => window.api.ssh.addTarget({ target: input }), {
      label,
      host: target.host,
      port: target.port,
      username: 'root',
      identityFile: target.identityFile,
      identitiesOnly: true
    })
    await openMachinesPage(page)
    // The files sidebar is the first thing a user closes to make room.
    await page.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
    await expect.poll(() => readMachine(page, label), { timeout: 60_000 }).not.toBeNull()
    const machine = (await readMachine(page, label))!
    await page.evaluate((machineId) => window.api.machines!.connect({ machineId }), machine.id)
    await showMachine(page, label)
    const detail = page.locator(`[data-machine-detail="${machine.id}"]`)
    await expect(detail.locator('[data-machine-meter="disk"]')).toBeVisible({ timeout: 120_000 })
    await launched.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1000)
    )

    return {
      page,
      app: launched.app,
      label,
      installDocker: (state = fakeDockerState()) => {
        writeHostFile(target, STATE_PATH, JSON.stringify(state))
        writeHostFile(target, `${BIN_DIR}/docker`, fakeDockerCliScript())
        execDockerSshHostTargetControlCommand(target, `chmod +x ${BIN_DIR}/docker`)
      },
      readState: () => {
        const state: FakeDockerState = JSON.parse(
          execDockerSshHostTargetControlCommand(target, `cat ${STATE_PATH}`)
        )
        return state
      },
      hasPath: (path) =>
        execDockerSshHostTargetControlCommand(
          target,
          `test -e '${path}' && echo yes || echo no`
        ).trim() === 'yes',
      openPanel: async (kind) => {
        const panel = page.locator(`[data-machine-resource-panel="${kind}"]`)
        if (!(await panel.isVisible())) {
          const close = page.locator('[data-machine-resource-close]')
          if (await close.isVisible()) {
            await close.click()
          }
          await detail.locator(`[data-machine-meter="${kind}"]`).click()
        }
        await expect(panel).toBeVisible()
        return panel
      },
      shot: async (name) => {
        // A hidden window draws no frames, so a transition would be caught at its first one.
        await page.screenshot({
          path: testInfo.outputPath('shots', `${name}.png`),
          animations: 'disabled'
        })
      },
      dispose
    }
  } catch (error) {
    await dispose()
    throw error
  }
}
