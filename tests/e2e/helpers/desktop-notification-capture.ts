// Records the desktop notifications the main process shows instead of handing them to the OS.
import type { ElectronApplication } from '@stablyai/playwright-test'

export type CapturedDesktopNotification = { title: string; body: string }

type ShownNotification = CapturedDesktopNotification & {
  instance: { emit: (event: string, ...args: unknown[]) => boolean }
}

type CaptureGlobal = typeof globalThis & { __sealE2eDesktopNotifications?: ShownNotification[] }

/**
 * From here on `Notification#show` records `{ title, body }` and shows nothing, and
 * `Notification.isSupported()` is true (it is false on a Linux runner with no notification daemon).
 * Both lanes build an Electron `Notification` in main, so both land here.
 */
export async function captureDesktopNotifications(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ Notification }) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a test-only slot on the main process global.
    const slot = globalThis as CaptureGlobal
    if (slot.__sealE2eDesktopNotifications) {
      return
    }
    const shown: ShownNotification[] = []
    slot.__sealE2eDesktopNotifications = shown
    Notification.isSupported = () => true
    Notification.prototype.show = function show(this: Electron.Notification): void {
      shown.push({ title: this.title, body: this.body, instance: this })
      // The general lane waits for the OS to confirm the display before it reports "delivered".
      setImmediate(() => this.emit('show'))
    }
  })
}

/** Every notification shown since the capture started or was last cleared, oldest first. */
export async function readDesktopNotifications(
  app: ElectronApplication
): Promise<CapturedDesktopNotification[]> {
  return app.evaluate(() =>
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the slot captureDesktopNotifications set.
    ((globalThis as CaptureGlobal).__sealE2eDesktopNotifications ?? []).map(({ title, body }) => ({
      title,
      body
    }))
  )
}

export async function clearDesktopNotifications(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the slot captureDesktopNotifications set.
    ;(globalThis as CaptureGlobal).__sealE2eDesktopNotifications?.splice(0)
  })
}

/** Clicks a captured notification as the OS would: emits `click` on the instance the app built. */
export async function clickDesktopNotification(app: ElectronApplication, index = 0): Promise<void> {
  await app.evaluate((_electron, at) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the slot captureDesktopNotifications set.
    const shown = (globalThis as CaptureGlobal).__sealE2eDesktopNotifications?.[at]
    if (!shown) {
      throw new Error(`No desktop notification was captured at index ${at}`)
    }
    shown.instance.emit('click')
  }, index)
}
