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
  const confirmedAt = Date.now()
  await confirm.click()
  await expect(row).toHaveCount(0, { timeout: ROW_GONE_WITHIN_MS })
  testInfo.annotations.push({
    type: 'row-gone-after-ms',
    description: String(Date.now() - confirmedAt)
  })
  await expect(confirm).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('stop-and-remove-row-gone.png') })
}
