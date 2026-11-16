// Docker storage on the Machines page of the real app, managed on a real machine over SSH. The
// machine has no Docker, so it gets a stand-in `docker` on its PATH that prints what Docker prints
// and keeps what it holds in a file; every removal is checked in that file, outside Seal.
import type { Locator } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { launchFakeDockerHost } from './helpers/machines-fake-docker-host'
import { fakeDockerState } from '../../src/main/machines/testing/fake-docker-default-state'
import { FAKE_DOCKER } from '../../src/main/machines/testing/fake-docker-state'

test.skip(process.env.ORCA_E2E_SSH_DOCKER !== '1', 'Needs Docker')

const { images, containers, volumes, buildCache } = FAKE_DOCKER

test('Docker storage is listed, inspected and cleaned up on an SSH machine', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its app and its host.
{}, testInfo) => {
  // Builds nothing, but starts a container with sshd and the app, then connects them.
  test.setTimeout(10 * 60_000)
  const host = await launchFakeDockerHost(testInfo, 'docker-box')
  try {
    const { page } = host
    const disk = await host.openPanel('disk')
    await disk.getByRole('tab', { name: 'Docker', exact: true }).click()
    const manager = disk.locator('[data-machine-docker-manager]')
    const row = (key: string): Locator => manager.locator(`[data-machine-docker-row="${key}"]`)
    const rows = manager.locator('[data-machine-docker-row]')
    const tick = (name: string): Promise<void> =>
      manager.getByRole('checkbox', { name: `Select ${name}`, exact: true }).click()
    const refresh = (): Promise<void> =>
      manager.getByRole('button', { name: 'Refresh', exact: true }).click()
    const category = async (kind: string): Promise<void> => {
      await manager.locator(`[data-machine-docker-category="${kind}"]`).click()
      await expect(manager).toHaveAttribute('data-machine-docker-manager', kind)
    }
    const imageTags = (): string[] => host.readState().images.flatMap((image) => image.tags)
    const containerNames = (): string[] =>
      host.readState().containers.map((container) => container.name)
    const volumeNames = (): string[] => host.readState().volumes.map((volume) => volume.name)

    await test.step('a machine without Docker, or an account that may not use it, says why', async () => {
      await expect(manager.locator('[data-machine-docker-unavailable="missing"]')).toContainText(
        'Docker is not installed on docker-box.',
        { timeout: 60_000 }
      )
      await host.shot('01-docker-not-installed')

      host.installDocker({ ...fakeDockerState(), permissionDenied: true })
      await refresh()
      const denied = manager.locator('[data-machine-docker-unavailable="permission"]')
      await expect(denied).toContainText('root cannot use Docker on docker-box.')
      await expect(denied.locator('[data-machine-docker-message]')).toContainText(
        'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock'
      )
      await host.shot('02-docker-permission-denied')

      host.installDocker()
      await refresh()
      await expect(manager).toHaveAttribute('data-machine-docker-manager', 'images')
    })

    await test.step('images show their size and who uses them, largest first', async () => {
      await expect(rows).toHaveCount(6)
      await expect(rows.first()).toHaveAttribute('data-machine-docker-row', 'postgres:16')
      await expect(row(images.nginx.reference)).toHaveAttribute('data-status', 'in-use')
      await expect(row(images.nginx.reference)).toContainText('old-job, web')
      await expect(row(images.node.reference)).toHaveAttribute('data-status', 'stopped-only')
      await expect(row(images.redis.reference)).toHaveAttribute('data-status', 'unused')
      await expect(row(images.dangling.id)).toHaveAttribute('data-status', 'dangling')
      await expect(row(images.postgres.reference)).toContainText('418 MB')
      // The summary above the tabs is Docker's own count.
      await expect(disk.locator('[data-machine-docker-storage-stat="images"]')).toContainText(
        'Images · 6'
      )

      await manager.getByRole('button', { name: /^Size/ }).click()
      await expect(rows.first()).toHaveAttribute(
        'data-machine-docker-row',
        images.distroless.reference
      )
      await manager.getByRole('button', { name: /^Size/ }).click()
      await expect(rows.first()).toHaveAttribute('data-machine-docker-row', 'postgres:16')

      await manager.locator('[data-machine-docker-unused-only]').click()
      await expect(rows).toHaveCount(3)
      await manager.locator('[data-machine-docker-unused-only]').click()
      await host.shot('03-images')
    })

    await test.step('removing picked images warns about one a stopped container uses and refuses one in use', async () => {
      await tick(images.redis.reference)
      await tick(images.node.reference)
      await tick(images.nginx.reference)
      await expect(manager.locator('[data-machine-docker-selection="3"]')).toBeVisible()
      await manager.locator('[data-machine-docker-remove-selected]').click()

      const dialog = page.locator('[data-machine-cleanup-dialog="docker-images"]')
      await expect(dialog).toContainText('Remove 3 images from docker-box?')
      const unused = dialog.locator('[data-machine-cleanup-item="removable"]')
      const inUse = dialog.locator('[data-machine-cleanup-item="in-use"]')
      const blocked = dialog.locator('[data-machine-cleanup-item="blocked"]')
      await expect(unused).toContainText(images.redis.reference)
      await expect(unused.getByRole('checkbox')).toBeChecked()
      await expect(inUse).toContainText('Used by stopped container migrate')
      await expect(inUse.getByRole('checkbox')).not.toBeChecked()
      await expect(blocked).toContainText(
        'Running container web uses it. Stop the container first.'
      )
      await expect(blocked.getByRole('checkbox')).toBeDisabled()
      const confirm = dialog.locator('[data-machine-cleanup-confirm]')
      await expect(confirm).toHaveText('Remove 1 item (112 MB)')

      await inUse.getByRole('checkbox').click()
      await expect(dialog.locator('[data-machine-cleanup-in-use-warning]')).toBeVisible()
      await expect(confirm).toHaveText('Remove anyway')
      await host.shot('04-remove-images-in-use-warning')
      await confirm.click()
      // A removal with nothing left over closes and says what it freed.
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      await expect(page.getByText('Freed 233 MB on docker-box.')).toBeVisible()

      expect(imageTags()).toEqual([
        images.nginx.reference,
        images.postgres.reference,
        images.distroless.reference
      ])
      // Only the image went: the stopped container that used it is still there.
      expect(containerNames()).toContain(containers.migrate.name)
      await expect(rows).toHaveCount(4)
      await expect(row(images.redis.reference)).toHaveCount(0)
    })

    await test.step('pruning dangling images removes only the untagged one', async () => {
      await manager.locator('[data-machine-docker-prune="docker-dangling-images"]').click()
      const dialog = page.locator('[data-machine-cleanup-dialog="docker-dangling-images"]')
      await expect(dialog.locator('[data-machine-cleanup-item]')).toHaveCount(1)
      await dialog.locator('[data-machine-cleanup-confirm]').click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      expect(host.readState().images.map((image) => image.id)).not.toContain(images.dangling.id)
      await expect(rows).toHaveCount(3)
    })

    await test.step('a volume shows who mounts it and its files, read-only', async () => {
      await category('volumes')
      await expect(rows).toHaveCount(3)
      await expect(row(volumes.pgdata)).toHaveAttribute('data-status', 'in-use')
      await expect(row(volumes.migrations)).toHaveAttribute('data-status', 'stopped-only')
      await expect(row(volumes.scratch)).toHaveAttribute('data-status', 'unused')

      await row(volumes.pgdata).getByText(volumes.pgdata, { exact: true }).click()
      const sheet = page.locator('[data-machine-docker-detail="volume"]')
      await expect(sheet.locator('[data-machine-docker-volume-detail="pgdata"]')).toContainText(
        'com.docker.compose.project'
      )
      await expect(sheet).toContainText('shop')
      await expect(sheet).toContainText('/var/lib/docker/volumes/pgdata/_data')
      await expect(sheet.locator('[data-machine-docker-used-by]')).toContainText('db')
      await expect(sheet.locator('[data-machine-docker-used-by]')).toContainText(
        '/var/lib/postgresql/data'
      )
      // Root may not read the volume's folder on this stand-in, so a helper container lists it.
      const tree = sheet.getByRole('tree', { name: 'Files in pgdata' })
      await expect(tree.getByRole('treeitem')).toHaveText([/PG_VERSION/, /postgresql\.conf/])
      await tree.getByRole('treeitem', { name: /postgresql\.conf/ }).click()
      const preview = sheet.locator('[data-machine-docker-volume-file="/postgresql.conf"]')
      await expect(preview).toContainText('max_connections = 100')
      await expect(preview.getByRole('button', { name: /Save|Edit|Download/ })).toHaveCount(0)
      await host.shot('05-volume-details-and-files')

      await sheet
        .locator('[data-machine-docker-used-by]')
        .getByRole('button', { name: 'db' })
        .click()
      const container = page.locator('[data-machine-docker-detail="container"]')
      await expect(container.locator('[data-machine-docker-state="running"]')).toBeVisible()
      await container.locator('[data-machine-docker-back]').click()
      await expect(sheet.locator('[data-machine-docker-volume-detail="pgdata"]')).toBeVisible()
      await sheet.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(sheet).toBeHidden()
    })

    await test.step('removing a volume a stopped container uses asks first, and takes the container with it', async () => {
      await tick(volumes.pgdata)
      await tick(volumes.migrations)
      await manager.locator('[data-machine-docker-remove-selected]').click()
      const dialog = page.locator('[data-machine-cleanup-dialog="docker-volumes"]')
      await expect(dialog.locator('[data-machine-cleanup-item="blocked"]')).toContainText(
        'Running container db uses it. Stop the container first.'
      )
      const inUse = dialog.locator('[data-machine-cleanup-item="in-use"]')
      await expect(inUse).toContainText('Used by stopped container migrate')
      // Nothing is ticked yet, so nothing can be removed by pressing through.
      const confirm = dialog.locator('[data-machine-cleanup-confirm]')
      await expect(confirm).toBeDisabled()
      await inUse.getByRole('checkbox').click()
      await expect(confirm).toHaveText('Remove anyway')
      await host.shot('06-remove-volume-in-use-warning')
      await confirm.click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })

      expect(volumeNames()).toEqual([volumes.pgdata, volumes.scratch])
      expect(containerNames()).toEqual([
        containers.web.name,
        containers.db.name,
        containers.oldJob.name
      ])
    })

    await test.step('a build cache record is removed by itself, and one in use is refused', async () => {
      await category('build-cache')
      await expect(rows).toHaveCount(4)
      await tick('local source for context')
      await tick('cached mount /root/.npm from exec /bin/sh -c npm ci')
      await manager.locator('[data-machine-docker-remove-selected]').click()
      const dialog = page.locator('[data-machine-cleanup-dialog="docker-build-cache"]')
      await expect(dialog.locator('[data-machine-cleanup-item="blocked"]')).toContainText(
        'A build is using it.'
      )
      await dialog.locator('[data-machine-cleanup-confirm]').click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
      expect(host.readState().buildCache.map((record) => record.id)).toEqual([
        buildCache.base,
        buildCache.layer,
        buildCache.busy
      ])
    })

    await test.step('Clean up unused leaves volumes alone unless they are ticked', async () => {
      await manager.locator('[data-machine-docker-clean-up]').click()
      const dialog = page.locator('[data-machine-docker-clean-up-dialog]')
      const group = (target: string): Locator =>
        dialog.locator(`[data-machine-docker-clean-up-category="${target}"]`)
      await expect(group('docker-volumes')).toHaveAttribute('data-state', 'ready')
      await expect(group('docker-containers').getByRole('checkbox')).toBeChecked()
      await expect(group('docker-build-cache').getByRole('checkbox')).toBeChecked()
      await expect(group('docker-volumes').getByRole('checkbox')).not.toBeChecked()
      await expect(group('docker-volumes')).toContainText('488 MB')
      // The dangling image is already gone.
      await expect(group('docker-dangling-images').getByRole('checkbox')).toBeDisabled()
      // One stopped container's writable layer and the two cache records no build is using.
      await expect(dialog.locator('[data-machine-docker-clean-up-total]')).toContainText('444 MB')
      await host.shot('07-clean-up-unused')
      await dialog.locator('[data-machine-docker-clean-up-confirm]').click()
      await expect(dialog.locator('[data-machine-docker-clean-up-result]')).toBeVisible()
      await host.shot('08-clean-up-unused-done')
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
      await expect(dialog).toBeHidden()

      expect(containerNames()).toEqual([containers.web.name, containers.db.name])
      expect(host.readState().buildCache.map((record) => record.id)).toEqual([buildCache.busy])
      expect(volumeNames()).toEqual([volumes.pgdata, volumes.scratch])
      await expect(rows).toHaveCount(1)
      await category('containers')
      await expect(rows).toHaveCount(2)
    })
  } finally {
    await host.dispose()
  }
})
