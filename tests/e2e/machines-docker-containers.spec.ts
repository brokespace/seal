// Running Docker containers in the CPU and RAM views of the Machines page, on a real machine over
// SSH, with the details and actions they share with the Docker storage view. The machine's
// `docker` is a stand-in that keeps what it holds in a file; every action is checked there.
import type { Locator } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { launchFakeDockerHost } from './helpers/machines-fake-docker-host'
import type { FakeDockerContainer } from '../../src/main/machines/testing/fake-docker-state'
import { FAKE_DOCKER } from '../../src/main/machines/testing/fake-docker-state'

test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs Docker')

const { containers, images } = FAKE_DOCKER

test('running containers show their live usage in the CPU and RAM views and open the shared details', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app and its host.
{}, testInfo) => {
  // Starts a container with sshd and the app, then connects them.
  test.setTimeout(10 * 60_000)
  const host = await launchFakeDockerHost(testInfo, 'docker-box')
  try {
    const { page } = host
    host.installDocker()
    const onHost = (name: string): FakeDockerContainer | undefined =>
      host.readState().containers.find((container) => container.name === name)
    const card = (panel: Locator): Locator =>
      panel.locator('[data-machine-docker-containers]:not(p)')
    const containerRow = (panel: Locator, id: string): Locator =>
      panel.locator(`[data-machine-docker-container="${id}"]`)
    const sheet = page.locator('[data-machine-docker-detail="container"]')
    const closeSheet = async (): Promise<void> => {
      await page
        .locator('[data-machine-docker-detail]')
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await expect(page.locator('[data-machine-docker-detail]')).toBeHidden()
    }

    await test.step('the CPU view lists running containers like docker stats, busiest first', async () => {
      const cpu = await host.openPanel('cpu')
      await expect(card(cpu)).toHaveAttribute('data-machine-docker-containers', 'cpu', {
        timeout: 60_000
      })
      const listed = cpu.locator('[data-machine-docker-container]')
      await expect(listed).toHaveCount(2)
      await expect(listed.first()).toHaveAttribute(
        'data-machine-docker-container',
        containers.db.id
      )
      const db = containerRow(cpu, containers.db.id)
      await expect(db).toContainText('db')
      await expect(db).toContainText('postgres:16')
      await expect(db).toContainText('12.3%')
      await expect(db).toContainText('1.50 GB / 2.00 GB')
      await expect(db).toContainText('75.0%')
      await expect(db).toContainText('47.2 KB / 126 B')
      await expect(db).toContainText('202 MB / 1.38 GB')
      await expect(db).toContainText('14')
      const web = containerRow(cpu, containers.web.id)
      await expect(web).toContainText('1.5%')
      await expect(web).toContainText('24.0 MB / 2.00 GB')
      // Stopped containers are not usage: they are managed with Docker's storage.
      await expect(containerRow(cpu, containers.migrate.id)).toHaveCount(0)

      await card(cpu)
        .getByRole('button', { name: /^Net I\/O/ })
        .click()
      await expect(card(cpu)).toHaveAttribute('data-machine-docker-containers', 'net')
      await expect(listed.first()).toHaveAttribute(
        'data-machine-docker-container',
        containers.web.id
      )
      await host.shot('01-cpu-containers')
    })

    await test.step('the RAM view ranks the same containers by memory, and the filter narrows them', async () => {
      const memory = await host.openPanel('memory')
      await expect(card(memory)).toHaveAttribute('data-machine-docker-containers', 'memory', {
        timeout: 60_000
      })
      const listed = memory.locator('[data-machine-docker-container]')
      await expect(listed).toHaveCount(2)
      await expect(listed.first()).toHaveAttribute(
        'data-machine-docker-container',
        containers.db.id
      )
      await memory.getByRole('textbox', { name: 'Filter processes' }).fill('nginx')
      await expect(listed).toHaveCount(1)
      await expect(listed).toHaveAttribute('data-machine-docker-container', containers.web.id)
      await memory.getByRole('textbox', { name: 'Filter processes' }).fill('')
      await host.shot('02-memory-containers')
    })

    await test.step('a container opens its status, setup and logs', async () => {
      const memory = await host.openPanel('memory')
      await memory.getByRole('button', { name: 'Details of container web', exact: true }).click()
      await expect(sheet.locator('[data-machine-docker-state="running"]')).toBeVisible()
      await expect(sheet.locator('[data-machine-docker-health="healthy"]')).toBeVisible()
      const setup = sheet.getByRole('region', { name: 'Setup' })
      await expect(setup).toContainText('nginx:1.27')
      await expect(setup).toContainText('nginx -g daemon off;')
      await expect(setup).toContainText('0.0.0.0:8080->80/tcp')
      await expect(sheet.getByRole('region', { name: 'Status' })).toContainText('unless-stopped')
      const logs = sheet.locator('[data-machine-docker-logs]')
      await expect(logs).toContainText('start worker processes')
      await expect(logs).toContainText('"GET /missing HTTP/1.1" 404 153')
      await expect(logs).toContainText('3 lines')
      await host.shot('03-container-details-and-logs')
    })

    await test.step('its image shows tags, layers and the containers that use it', async () => {
      await sheet
        .getByRole('region', { name: 'Setup' })
        .getByRole('button', { name: 'nginx:1.27' })
        .click()
      const image = page.locator('[data-machine-docker-detail="image"]')
      await expect(
        image.locator(`[data-machine-docker-image-detail="${images.nginx.id}"]`)
      ).toBeVisible()
      await expect(image.getByRole('region', { name: 'Image' })).toContainText('nginx:1.27')
      await expect(image.locator('[data-machine-docker-layer]')).toHaveCount(3)
      await expect(image.locator('[data-machine-docker-layer="1"]')).toContainText('install')
      await expect(image.locator('[data-machine-docker-used-by]')).toHaveText([/web/, /old-job/])
      await host.shot('04-image-details')
      await image.locator('[data-machine-docker-back]').click()
      await expect(sheet.locator('[data-machine-docker-state="running"]')).toBeVisible()
    })

    await test.step('stopping asks first, and a cancelled stop does nothing', async () => {
      await sheet.getByRole('button', { name: 'Stop', exact: true }).click()
      const dialog = page.locator('[data-machine-docker-dialog="stop"]')
      await expect(dialog).toContainText('Stop container web?')
      await host.shot('05-stop-confirmation')
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toBeHidden()
      expect(onHost('web')?.state).toBe('running')

      await sheet.getByRole('button', { name: 'Stop', exact: true }).click()
      await dialog.getByRole('button', { name: 'Stop container', exact: true }).click()
      await expect(sheet.locator('[data-machine-docker-state="exited"]')).toBeVisible({
        timeout: 30_000
      })
      expect(onHost('web')?.state).toBe('exited')
      await closeSheet()
      const memory = page.locator('[data-machine-resource-panel="memory"]')
      await expect(memory.locator('[data-machine-docker-container]')).toHaveCount(1, {
        timeout: 30_000
      })
    })

    await test.step('restarting from the row asks first too', async () => {
      const memory = page.locator('[data-machine-resource-panel="memory"]')
      const startedBefore = onHost('db')?.startedAt
      await containerRow(memory, containers.db.id)
        .getByRole('button', { name: 'Restart', exact: true })
        .click()
      const dialog = page.locator('[data-machine-docker-dialog="restart"]')
      await expect(dialog).toContainText('Restart container db?')
      await dialog.getByRole('button', { name: 'Restart container', exact: true }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      expect(onHost('db')?.state).toBe('running')
      expect(onHost('db')?.startedAt).not.toBe(startedBefore)
    })

    await test.step('stopped containers are started and removed from Docker storage, through the same details', async () => {
      const disk = await host.openPanel('disk')
      await disk.getByRole('tab', { name: 'Docker', exact: true }).click()
      const manager = disk.locator('[data-machine-docker-manager]')
      await manager.locator('[data-machine-docker-category="containers"]').click()
      const stored = (id: string): Locator => manager.locator(`[data-machine-docker-row="${id}"]`)
      await expect(manager.locator('[data-machine-docker-row]')).toHaveCount(4)
      await expect(stored(containers.web.id)).toHaveAttribute('data-status', 'stopped')
      await expect(stored(containers.db.id)).toHaveAttribute('data-status', 'running')
      await host.shot('06-storage-containers')

      await stored(containers.web.id).getByRole('button', { name: 'Start', exact: true }).click()
      await expect(stored(containers.web.id)).toHaveAttribute('data-status', 'running', {
        timeout: 30_000
      })
      expect(onHost('web')?.state).toBe('running')

      await stored(containers.oldJob.id).getByText('old-job', { exact: true }).click()
      await expect(sheet.locator('[data-machine-docker-state="exited"]')).toBeVisible()
      await expect(sheet.locator('[data-machine-docker-logs]')).toContainText(
        'nginx: configuration file test failed'
      )
      await sheet.getByRole('button', { name: 'Remove', exact: true }).click()
      const dialog = page.locator('[data-machine-docker-dialog="remove"]')
      await expect(dialog).toContainText('Remove container old-job?')
      await host.shot('07-remove-confirmation')
      await dialog.getByRole('button', { name: 'Remove container', exact: true }).click()
      await expect(page.locator('[data-machine-docker-detail]')).toBeHidden({ timeout: 30_000 })
      expect(onHost('old-job')).toBeUndefined()
      await expect(manager.locator('[data-machine-docker-row]')).toHaveCount(3, { timeout: 30_000 })
    })
  } finally {
    await host.dispose()
  }
})
