// "Stop and remove" on a session's row, done as the user does it, with how long the row took to leave.
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect } from './orca-app'

/** The row leaves the list this soon after the user confirms; the agent is stopped behind that. */
const ROW_GONE_WITHIN_MS = 2_000

export async function stopAndRemoveFromRow(
  page: Page,
  row: Locator,
  testInfo: TestInfo
): Promise<void> {
  await row.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Stop and remove…' }).click()
  const confirm = page.getByTestId('live-session-danger-confirm')
  await expect(confirm).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('stop-and-remove-dialog.png') })
  // Timed in the page, from the click as the app gets it: Playwright takes up to two seconds to land one in the hidden window.
  await row.evaluate(
    (rowElement, confirmElement) => {
      const id = rowElement.getAttribute('data-live-session-row')
      const listed = (): boolean =>
        id === null
          ? rowElement.isConnected
          : document.querySelector(`[data-live-session-row="${CSS.escape(id)}"]`) !== null
      delete document.body.dataset.rowGoneAfterMs
      confirmElement?.addEventListener(
        'click',
        () => {
          const clickedAt = performance.now()
          const observer = new MutationObserver(() => {
            if (!listed()) {
              observer.disconnect()
              document.body.dataset.rowGoneAfterMs = String(
                Math.round(performance.now() - clickedAt)
              )
            }
          })
          observer.observe(document.body, { childList: true, subtree: true })
        },
        { capture: true, once: true }
      )
    },
    await confirm.elementHandle()
  )
  await confirm.click()
  const timed = page.locator('body[data-row-gone-after-ms]')
  await expect(timed).toHaveCount(1, { timeout: ROW_GONE_WITHIN_MS })
  const goneAfterMs = Number(await timed.getAttribute('data-row-gone-after-ms'))
  testInfo.annotations.push({ type: 'row-gone-after-ms', description: String(goneAfterMs) })
  expect(goneAfterMs).toBeLessThan(ROW_GONE_WITHIN_MS)
  await expect(row).toHaveCount(0)
  await expect(confirm).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('stop-and-remove-row-gone.png') })
}
