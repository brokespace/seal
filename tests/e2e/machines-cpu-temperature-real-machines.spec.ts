// The CPU temperature on the Machines page of the real app, read from real machines: this computer,
// three accounts behind a real sshd and a paired Seal server. They are all this one host, and a CI
// host is a virtual machine without a sensor, so thermal zones are staged where the kernel shows
// them. One zone is readable by a single account, which tells the machines' readings apart.
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { localSshdUnavailableReason } from './helpers/local-sshd-machines'
import { launchHomeChatOnRealMachines } from './home-chat-tools/real-machine-targets'
import type { Target, TargetKey } from './home-chat-tools/tool-case-types'

const ZONES = '/sys/class/thermal'
const EVERY_MACHINE: readonly TargetKey[] = [
  'local',
  'ssh-zsh',
  'ssh-bash',
  'ssh-fish',
  'seal-server'
]

function sudo(args: readonly string[], input = ''): void {
  execFileSync('sudo', ['-n', ...args], { input })
}

function stageZone(index: number, type: string, millidegrees: number): void {
  const zone = `${ZONES}/thermal_zone${index}`
  sudo(['mkdir', '-p', zone])
  sudo(['tee', `${zone}/type`], `${type}\n`)
  sudo(['tee', `${zone}/temp`], `${millidegrees}\n`)
}

function machineRow(page: Page, target: Target): Locator {
  const rows = page.locator('[data-machines-page]')
  return target.key === 'local'
    ? rows.locator('[data-machine-id="local"]')
    : rows.locator('[data-machine-id]', { hasText: target.label })
}

async function openCpuPanel(page: Page, target: Target): Promise<Locator> {
  const panel = page.locator('[data-machine-resource-panel="cpu"]')
  const close = page.locator('[data-machine-resource-close]')
  if (await close.isVisible()) {
    await close.click()
    await expect(panel).toBeHidden()
  }
  await machineRow(page, target).click()
  const meter = page.locator('[data-machine-detail] [data-machine-meter="cpu"]')
  await expect(meter).toBeVisible({ timeout: 60_000 })
  await meter.click()
  await expect(panel.locator('[data-machine-cpu-temperature]')).toBeVisible({ timeout: 60_000 })
  return panel
}

test('the CPU temperature shows on the Machines page for this computer and every remote machine', async ({
  testRepoPath
}, testInfo) => {
  const unavailable = localSshdUnavailableReason()
  // A developer machine without sudo cannot host the accounts; CI must never skip them.
  test.skip(unavailable !== null && !process.env.CI, unavailable ?? '')
  expect(unavailable, 'CI must be able to run a real sshd').toBeNull()
  // Three sshd accounts, a paired Seal server and the app start first; a healthy run takes ninety seconds.
  test.setTimeout(10 * 60_000)

  const shotsDir =
    process.env.SEAL_MACHINES_CPU_TEMPERATURE_SHOTS_DIR ?? testInfo.outputPath('shots')
  mkdirSync(shotsDir, { recursive: true })
  let staged = false
  const removeZones = (): void => {
    if (staged) {
      staged = false
      // Lazy, because a machine may be in the middle of reading a zone.
      sudo(['umount', '-l', ZONES])
    }
  }
  // Seal looks for a sensor when it first reads a machine, so the zones are in place before it connects.
  sudo(['mount', '-t', 'tmpfs', '-o', 'mode=755', 'tmpfs', ZONES])
  staged = true
  let suite: Awaited<ReturnType<typeof launchHomeChatOnRealMachines>> | undefined
  try {
    stageZone(0, 'acpitz', 41_000)
    stageZone(1, 'acpitz', 38_000)
    suite = await launchHomeChatOnRealMachines(testInfo, testRepoPath)
    const { page, targets, app } = suite.env
    const shot = async (name: string): Promise<void> => {
      // A hidden window draws no frames, so a transition would be caught at its first one.
      await page.screenshot({ path: path.join(shotsDir, `${name}.png`), animations: 'disabled' })
    }
    const targetOf = (key: TargetKey): Target => targets.find((target) => target.key === key)!
    /** The hover of a machine's CPU bar in the list: `CPU: load 0.52 · 41 °C`. */
    const listReading = (key: TargetKey): Locator =>
      machineRow(page, targetOf(key)).locator('[title^="CPU: "]')
    const overSsh = targetOf('ssh-zsh')
    const server = targetOf('seal-server')

    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1000)
    )
    await page.evaluate(() => window.__store!.getState().setActiveView('machines'))
    await page.waitForSelector('[data-machines-page]')

    await test.step('the list carries each machine’s temperature', async () => {
      for (const key of EVERY_MACHINE) {
        await expect(listReading(key), key).toHaveAttribute('title', /· 41 °C$/, {
          timeout: 120_000
        })
      }
      await shot('01-list')
    })

    await test.step('this computer: the vitals, the headline figure and each sensor', async () => {
      const panel = await openCpuPanel(page, targetOf('local'))
      await expect(page.locator('[data-machine-detail] [data-machine-meter="cpu"]')).toContainText(
        '· 41 °C'
      )
      const stat = panel.locator('[data-machine-cpu-temperature="reading"]')
      await expect(stat).toContainText('41 °C')
      await expect(stat).toContainText('ACPI thermal zone · acpitz 0')
      const sensors = panel.locator('[data-machine-cpu-sensors="2"]')
      await expect(sensors).toContainText('acpitz 0')
      await expect(sensors).toContainText('acpitz 1')
      await expect(sensors).toContainText('38 °C')
      // The figures sit above the processes, which are still listed below them.
      await expect(panel.locator('[data-machine-process]').first()).toBeVisible({ timeout: 60_000 })
      await shot('02-local-cpu-panel')
    })

    await test.step('a reading that moves is followed with nothing pressed', async () => {
      sudo(['tee', `${ZONES}/thermal_zone0/temp`], '77000\n')
      const stat = page.locator(
        '[data-machine-resource-panel="cpu"] [data-machine-cpu-temperature="reading"]'
      )
      await expect(stat).toContainText('77 °C', { timeout: 60_000 })
      await shot('03-local-hotter')
    })

    await test.step('through a Seal server', async () => {
      const panel = await openCpuPanel(page, server)
      const stat = panel.locator('[data-machine-cpu-temperature="reading"]')
      await expect(stat).toContainText('77 °C', { timeout: 60_000 })
      await expect(stat).toContainText('ACPI thermal zone · acpitz 0')
      await expect(panel.locator('[data-machine-cpu-sensors="2"]')).toBeVisible()
      await shot('04-server-cpu-panel')
    })

    await test.step('over SSH, a sensor only that account may read shows on that machine alone', async () => {
      stageZone(2, 'x86_pkg_temp', 63_000)
      sudo(['chown', '-R', overSsh.username, `${ZONES}/thermal_zone2`])
      sudo(['chmod', '700', `${ZONES}/thermal_zone2`])
      await expect(listReading('ssh-zsh')).toHaveAttribute('title', /· 63 °C$/, { timeout: 60_000 })
      const panel = await openCpuPanel(page, overSsh)
      const stat = panel.locator('[data-machine-cpu-temperature="reading"]')
      await expect(stat).toContainText('63 °C', { timeout: 60_000 })
      // The package sensor outranks the board's zones, and it is the only one of its kind.
      await expect(stat).toContainText('Thermal zone · x86_pkg_temp')
      await expect(panel.locator('[data-machine-cpu-sensors]')).toHaveCount(0)
      for (const key of ['local', 'ssh-bash', 'ssh-fish', 'seal-server'] as const) {
        await expect(listReading(key), key).toHaveAttribute('title', /· 77 °C$/)
      }
      await shot('05-ssh-cpu-panel')
    })

    await test.step('a machine without a readable sensor says so, and shows no figure', async () => {
      removeZones()
      const panel = page.locator('[data-machine-resource-panel="cpu"]')
      const missing = panel.locator('[data-machine-cpu-temperature="unavailable"]')
      await expect(missing).toContainText('no readable sensor', { timeout: 60_000 })
      await expect(missing).toContainText('—')
      await expect(panel).not.toContainText('°C')
      await expect(
        page.locator('[data-machine-detail] [data-machine-meter="cpu"]')
      ).not.toContainText('°C')
      for (const key of EVERY_MACHINE) {
        await expect(listReading(key), key).not.toHaveAttribute('title', /°C/, { timeout: 60_000 })
      }
      await shot('06-ssh-no-sensor')
      await openCpuPanel(page, targetOf('local'))
      await expect(missing).toContainText('no readable sensor')
      await shot('07-local-no-sensor')
    })
  } finally {
    try {
      removeZones()
    } catch (error) {
      console.warn('[machines-cpu-temperature] cleanup failed:', error)
    }
    await suite?.dispose()
  }
})
