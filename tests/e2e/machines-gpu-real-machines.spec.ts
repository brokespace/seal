// GPUs on the Machines page of the real app, read from real machines: this computer (no GPU), three
// accounts behind a real sshd and a paired Seal server. No machine here has a GPU, so each account
// gets a stand-in `nvidia-smi` on its PATH that prints recorded-style output and lists processes
// this test really started. Every kill is checked on the machine itself, outside Seal.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { localSshdUnavailableReason } from './helpers/local-sshd-machines'
import { launchHomeChatOnRealMachines } from './home-chat-tools/real-machine-targets'
import type { Target, TargetKey } from './home-chat-tools/tool-case-types'
import {
  fakeDockerScript,
  fakeNvidiaSmiScript,
  NVIDIA_SMI_FIXTURES,
  type NvidiaSmiFixture
} from '../../src/main/machines/testing/fake-nvidia-smi'

const GPUS_ON: Partial<Record<TargetKey, { fixture: NvidiaSmiFixture; live?: boolean }>> = {
  'ssh-zsh': { fixture: NVIDIA_SMI_FIXTURES.oneRtx4090 },
  'ssh-bash': { fixture: NVIDIA_SMI_FIXTURES.twoWithMig },
  'ssh-fish': { fixture: NVIDIA_SMI_FIXTURES.oldDriverTwoK80 },
  'seal-server': { fixture: NVIDIA_SMI_FIXTURES.eightA100, live: true }
}
const CONTAINER_ID = 'f3a91c0de2b74c5a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c'
const CONTAINER_CGROUP = `/sys/fs/cgroup/docker-${CONTAINER_ID}.scope`
const A100_UUID = 'GPU-11111111-aaaa-4bbb-8ccc-00000000000'
/** A pid above the kernel's default limit, so it is on no machine's process list. */
const PID_ELSEWHERE = 4_194_000

type Sh = Target['sh']

function installGpuTools(key: TargetKey, sh: Sh): void {
  const gpus = GPUS_ON[key]
  if (!gpus) {
    return
  }
  const install = (name: string, script: string): void => {
    sh(`mkdir -p ~/bin && cat > ~/bin/${name} && chmod +x ~/bin/${name}`, script)
  }
  install('nvidia-smi', fakeNvidiaSmiScript(gpus.fixture, { live: gpus.live }))
  if (key === 'seal-server') {
    install('docker', fakeDockerScript([{ id: CONTAINER_ID, name: 'jupyter' }]))
  }
}

/** Starts a process that outlives this call, as the machine's user; `command` replaces the shell. */
function startJob(sh: Sh, command: string): number {
  return Number(
    sh(`nohup sh -c '${command}' >/dev/null 2>&1 </dev/null & echo $!`).toString().trim()
  )
}

function isRunning(sh: Sh, pid: number): boolean {
  return (
    sh(`kill -0 ${pid} 2>/dev/null && echo running || echo gone`).toString().trim() === 'running'
  )
}

function listOnGpus(sh: Sh, rows: readonly string[]): void {
  sh('cat > ~/bin/nvidia-smi.apps', `${rows.join('\n')}\n`)
}

function sudo(args: readonly string[], input = ''): void {
  execFileSync('sudo', ['-n', ...args], { input })
}

function machineRow(page: Page, target: Target): Locator {
  const rows = page.locator('[data-machines-page]')
  return target.key === 'local'
    ? rows.locator('[data-machine-id="local"]')
    : rows.locator('[data-machine-id]', { hasText: target.label })
}

async function openGpuPanel(page: Page, target: Target): Promise<Locator> {
  await machineRow(page, target).click()
  const meter = page.locator('[data-machine-detail] [data-machine-meter="gpu"]')
  await expect(meter).toBeVisible({ timeout: 60_000 })
  await meter.click()
  const panel = page.locator('[data-machine-resource-panel="gpu"]')
  await expect(panel.locator('[data-machine-gpu-card]').first()).toBeVisible({ timeout: 60_000 })
  return panel
}

async function confirmSignal(
  page: Page,
  row: Locator,
  button: 'Stop' | 'Force kill',
  confirm: 'Stop process' | 'Force kill'
): Promise<Locator> {
  await row.getByRole('button', { name: button, exact: true }).click()
  const dialog = page.locator(
    `[data-machine-signal-dialog="${button === 'Stop' ? 'TERM' : 'KILL'}"]`
  )
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: confirm, exact: true }).click()
  return dialog
}

test('GPUs, their history and their processes show on the Machines page, and a GPU process can be stopped', async ({
  testRepoPath
}, testInfo) => {
  const unavailable = localSshdUnavailableReason()
  // A developer machine without sudo cannot host the accounts; CI must never skip them.
  test.skip(unavailable !== null && !process.env.CI, unavailable ?? '')
  expect(unavailable, 'CI must be able to run a real sshd').toBeNull()
  test.setTimeout(15 * 60_000)

  const shotsDir = process.env.SEAL_MACHINES_GPU_SHOTS_DIR ?? testInfo.outputPath('shots')
  mkdirSync(shotsDir, { recursive: true })
  const cleanups: (() => void)[] = []
  // Seal looks for a GPU when it first reads a machine, so the tools are in place before it connects.
  const suite = await launchHomeChatOnRealMachines(testInfo, testRepoPath, {
    beforeConnect: installGpuTools
  })
  try {
    const { page, targets, app } = suite.env
    const shot = async (name: string): Promise<void> => {
      // A hidden window draws no frames, so a transition would be caught at its first one.
      await page.screenshot({ path: path.join(shotsDir, `${name}.png`), animations: 'disabled' })
    }
    const resize = (width: number, height: number): Promise<void> =>
      app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height),
        { width, height }
      )
    const targetOf = (key: TargetKey): Target => targets.find((target) => target.key === key)!
    const server = targetOf('seal-server')
    const overSsh = targetOf('ssh-zsh')

    const training = startJob(server.sh, 'exec sleep 900')
    const notebook = startJob(server.sh, 'exec sleep 901')
    const stubborn = startJob(server.sh, 'trap "" TERM; exec sleep 902')
    const sshJob = startJob(overSsh.sh, 'exec sleep 903')
    cleanups.push(() => {
      server.sh(`kill -9 ${training} ${notebook} ${stubborn} 2>/dev/null; true`)
      overSsh.sh(`kill -9 ${sshJob} 2>/dev/null; true`)
      sudo(['rmdir', CONTAINER_CGROUP])
    })
    // Docker names a container's cgroup after its id; that is how Seal finds a process's container.
    sudo(['mkdir', CONTAINER_CGROUP])
    sudo(['tee', `${CONTAINER_CGROUP}/cgroup.procs`], String(notebook))
    listOnGpus(server.sh, [
      `${A100_UUID}0, ${training}, 70516, python`,
      `${A100_UUID}1, ${training}, 70510, python`,
      `${A100_UUID}4, ${notebook}, 39800, /opt/conda/bin/python3.11`,
      `${A100_UUID}6, ${stubborn}, 77900, tritonserver`,
      `always:${A100_UUID}2, ${PID_ELSEWHERE}, 70500, python`
    ])
    listOnGpus(overSsh.sh, [`GPU-3a9c6f6e-5d0b-7c1e-9b55-0a1f4d2c8e71, ${sshJob}, 19876, python3`])

    await resize(1440, 1000)
    await page.evaluate(() => window.__store!.getState().setActiveView('machines'))
    await page.waitForSelector('[data-machines-page]')

    await test.step('the list shows each machine’s GPUs, and nothing for a machine without one', async () => {
      const summaryOf = (key: TargetKey): Locator =>
        machineRow(page, targetOf(key)).locator('[data-machine-gpu-summary]')
      await expect(summaryOf('seal-server')).toContainText('8 GPUs', { timeout: 120_000 })
      await expect(summaryOf('seal-server')).toContainText('/ 640 GB')
      await expect(summaryOf('seal-server').locator('[data-machine-gpu-cell]')).toHaveCount(8)
      await expect(summaryOf('ssh-zsh')).toContainText('1 GPU · 87% · 19.9 / 24.0 GB', {
        timeout: 60_000
      })
      await expect(summaryOf('ssh-zsh').locator('[data-machine-gpu-cell]')).toHaveCount(1)
      // The MIG card reports no utilization, so the average is the other card's.
      await expect(summaryOf('ssh-bash')).toContainText('2 GPUs · 34% · 22 / 104 GB', {
        timeout: 60_000
      })
      await expect(summaryOf('ssh-fish')).toContainText('2 GPUs · 22% · 8.5 / 22.3 GB', {
        timeout: 60_000
      })
      // This computer was read in the same pass as the others, and it has no GPU.
      await expect(machineRow(page, targetOf('local'))).toContainText('CPU')
      await expect(summaryOf('local')).toHaveCount(0)
      await shot('01-list-0-1-2-8-gpus')
    })

    await test.step('a machine without a GPU has no GPU meter', async () => {
      await machineRow(page, targetOf('local')).click()
      await expect(page.locator('[data-machine-detail] [data-machine-meter="cpu"]')).toBeVisible({
        timeout: 60_000
      })
      await expect(page.locator('[data-machine-detail] [data-machine-meter="gpu"]')).toHaveCount(0)
      await shot('02-detail-no-gpu')
    })

    await test.step('eight GPUs through a Seal server: readings, history and processes', async () => {
      const panel = await openGpuPanel(page, server)
      await expect(panel.locator('[data-machine-gpu-card]')).toHaveCount(8)
      await expect(panel).toContainText('NVIDIA A100-SXM4-80GB')
      // An idle card: these figures are not the ones the stand-in moves.
      const idle = panel.locator('[data-machine-gpu-card="7"]')
      await expect(idle).toContainText('0.0 / 80.0 GB')
      await expect(idle).toContainText('33 °C')
      await expect(idle).toContainText('56 / 400 W')
      await expect(idle).toContainText('210 / 405 MHz')
      // A datacenter card has no fan to report.
      await expect(idle).not.toContainText('Fan')

      const trainingRow = panel.locator(`[data-machine-process="${training}"]`)
      await expect(trainingRow).toContainText('GPU 0')
      await expect(trainingRow).toContainText('GPU 1')
      // 70516 MiB on one GPU and 70510 MiB on the other.
      await expect(trainingRow).toContainText('138 GB')
      await expect(trainingRow).toContainText('sleep 900')
      await expect(trainingRow).toContainText(server.username)
      const notebookRow = panel.locator(`[data-machine-process="${notebook}"]`)
      await expect(notebookRow).toContainText('GPU 4')
      await expect(notebookRow).toContainText('jupyter')
      await expect(notebookRow).toContainText('38.9 GB')
      await expect(panel.locator(`[data-machine-process="${stubborn}"]`)).toContainText('GPU 6')
      await expect(panel.locator('[data-machine-process]')).toHaveCount(3)
      await expect(panel.locator('[data-machine-gpu-unlisted]')).toContainText(
        String(PID_ELSEWHERE)
      )

      // Readings keep arriving with nothing pressed: the busy card's line grows and its figure moves.
      const busy = panel.locator('[data-machine-gpu-card="0"]')
      await expect(busy.locator('[data-machine-gpu-history] svg').first()).toBeVisible({
        timeout: 30_000
      })
      const seen = new Set<string>()
      await expect
        .poll(
          async () => {
            seen.add(
              (await busy
                .getByText(/^\d+%$/)
                .first()
                .textContent()) ?? ''
            )
            return seen.size
          },
          { timeout: 60_000, message: 'GPU 0 utilization never changed' }
        )
        .toBeGreaterThan(1)
      await shot('03-server-8-gpus-panel')
    })

    await test.step('stopping a GPU process asks first, then SIGTERM, then SIGKILL', async () => {
      const panel = page.locator('[data-machine-resource-panel="gpu"]')
      const trainingRow = panel.locator(`[data-machine-process="${training}"]`)
      await trainingRow.getByRole('button', { name: 'Stop', exact: true }).click()
      const dialog = page.locator('[data-machine-signal-dialog="TERM"]')
      await expect(dialog).toContainText(`Sends SIGTERM to process ${training} on ${server.label}`)
      await shot('04-stop-confirmation')
      await dialog.getByRole('button', { name: 'Cancel' }).click()
      await expect(dialog).toBeHidden()
      expect(isRunning(server.sh, training), 'cancelled: nothing was signalled').toBe(true)

      await confirmSignal(page, trainingRow, 'Stop', 'Stop process')
      await expect.poll(() => isRunning(server.sh, training), { timeout: 30_000 }).toBe(false)
      await expect(trainingRow).toHaveCount(0, { timeout: 30_000 })

      // This one ignores SIGTERM, so it is still there and Force kill is what ends it.
      const stubbornRow = panel.locator(`[data-machine-process="${stubborn}"]`)
      await confirmSignal(page, stubbornRow, 'Stop', 'Stop process')
      await expect(page.locator('[data-machine-signal-dialog]')).toBeHidden()
      await expect(panel.locator('[data-machine-process]')).toHaveCount(2, { timeout: 30_000 })
      expect(isRunning(server.sh, stubborn)).toBe(true)
      await stubbornRow.getByRole('button', { name: 'Force kill', exact: true }).click()
      const killDialog = page.locator('[data-machine-signal-dialog="KILL"]')
      await expect(killDialog).toContainText(
        `Sends SIGKILL to process ${stubborn} on ${server.label}`
      )
      await shot('05-force-kill-confirmation')
      await killDialog.getByRole('button', { name: 'Force kill', exact: true }).click()
      await expect.poll(() => isRunning(server.sh, stubborn), { timeout: 30_000 }).toBe(false)
      await expect(stubbornRow).toHaveCount(0, { timeout: 30_000 })
      expect(isRunning(server.sh, notebook), 'the other GPU process was left alone').toBe(true)
      await shot('06-after-kills')
    })

    await test.step('a narrow window keeps all eight GPUs readable', async () => {
      const panel = page.locator('[data-machine-resource-panel="gpu"]')
      // The files sidebar is the first thing a user closes to make room.
      await page.evaluate(() => window.__store!.getState().setRightSidebarOpen(false))
      await shot('07-server-8-gpus-wide-panel')
      await resize(900, 900)
      await expect(panel.locator('[data-machine-gpu-card]')).toHaveCount(8)
      await expect(panel.locator('[data-machine-gpu-card="7"]')).toContainText('0.0 / 80.0 GB')
      const cutOff = await panel.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return Array.from(element.querySelectorAll('[data-machine-gpu-card]')).filter((card) => {
          const box = card.getBoundingClientRect()
          return box.left < bounds.left || box.right > bounds.right || box.width < 180
        }).length
      })
      expect(cutOff, 'GPU cards cut off or squeezed in a narrow panel').toBe(0)
      await shot('08-narrow-8-gpus-panel')
      await page.locator('[data-machine-resource-close]').click()
      const cells = page.locator(
        '[data-machine-detail] [data-machine-meter="gpu"] [data-machine-gpu-cell]'
      )
      await expect(cells).toHaveCount(8)
      await expect(cells.last()).toBeVisible()
      await shot('09-narrow-detail')
      await resize(1440, 1000)
      await page.evaluate(() => window.__store!.getState().setRightSidebarOpen(true))
    })

    await test.step('one GPU over SSH: its process is force killed as that account', async () => {
      const panel = await openGpuPanel(page, overSsh)
      await expect(panel.locator('[data-machine-gpu-card]')).toHaveCount(1)
      const card = panel.locator('[data-machine-gpu-card="0"]')
      await expect(card).toContainText('87%')
      await expect(card).toContainText('19.9 / 24.0 GB')
      await expect(card).toContainText('71 °C')
      await expect(card).toContainText('312 / 450 W')
      await expect(card).toContainText('64%')
      await expect(card).toContainText('2520 / 10501 MHz')
      const row = panel.locator(`[data-machine-process="${sshJob}"]`)
      await expect(row).toContainText('GPU 0')
      await expect(row).toContainText('19.4 GB')
      await expect(row).toContainText(overSsh.username)
      await shot('10-ssh-1-gpu-panel')
      await confirmSignal(page, row, 'Force kill', 'Force kill')
      await expect.poll(() => isRunning(overSsh.sh, sshJob), { timeout: 30_000 }).toBe(false)
      await expect(row).toHaveCount(0, { timeout: 30_000 })
      await expect(panel).toContainText('No process is using a GPU.')
    })

    await test.step('a MIG card and an old driver show what they report, and no more', async () => {
      const mig = await openGpuPanel(page, targetOf('ssh-bash'))
      await expect(mig.locator('[data-machine-gpu-card]')).toHaveCount(2)
      await expect(mig).toContainText('MIG')
      await expect(mig.locator('[data-machine-gpu-card="1"]')).toContainText('13.1 / 80.0 GB')
      await expect(mig.locator('[data-machine-gpu-card="1"]')).toContainText('97 / 400 W')
      await expect(mig.locator('[data-machine-gpu-card="0"]')).toContainText('34%')
      await shot('11-ssh-2-gpus-mig-panel')

      const old = await openGpuPanel(page, targetOf('ssh-fish'))
      await expect(old).toContainText('Tesla K80')
      const first = old.locator('[data-machine-gpu-card="0"]')
      await expect(first).toContainText('43%')
      await expect(first).toContainText('8.5 / 11.2 GB')
      await expect(first).toContainText('62 °C')
      await expect(first).not.toContainText('Power')
      await shot('12-ssh-old-driver-panel')
    })
  } finally {
    for (const cleanup of cleanups) {
      try {
        cleanup()
      } catch (error) {
        console.warn('[machines-gpu] cleanup failed:', error)
      }
    }
    await suite.dispose()
  }
})
