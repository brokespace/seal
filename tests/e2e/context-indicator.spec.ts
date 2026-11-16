// The composer's context ring on a Claude chat: empty, normal, near, critical, then a compaction from "Compact now".

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { JSHandle, Locator, Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { SUPPORTED, openStubChat, test as stubTest } from './helpers/structured-claude-stub'

const test = stubTest.extend({
  claudeStub: async ({ claudeStub }, provideFixture) => {
    // The stock wrapper already isolates PATH; only the script it runs changes.
    const wrapper = readFileSync(claudeStub.command, 'utf8')
    expect(wrapper).toContain('structured-claude-stub.cjs')
    writeFileSync(
      claudeStub.command,
      wrapper.replace('structured-claude-stub.cjs', 'context-indicator-claude-stub.cjs')
    )
    await provideFixture(claudeStub)
  }
})

// Set to a directory to save the ring and popover screenshots; unset in CI.
const SHOTS_DIR = process.env.CONTEXT_INDICATOR_SHOTS_DIR
const SHOT_MARGIN = 12
const CARD_ROOM = 330

// The stub reports a 200k window that compacts at 160k, and 64k, 131.2k, then 153.6k used.
const LEVELS = [
  {
    name: '40',
    percent: '32',
    state: 'normal',
    text: null,
    usage: '64k of 200k tokens (32%)',
    distance: 'Compacts automatically at 160k: 96k left'
  },
  {
    name: '82',
    percent: '66',
    state: 'near',
    text: 'Compacts soon',
    usage: '131.2k of 200k tokens (66%)',
    distance: 'Compacts automatically at 160k: 28.8k left'
  },
  {
    name: '96',
    percent: '77',
    state: 'critical',
    text: 'Context almost full',
    usage: '153.6k of 200k tokens (77%)',
    distance: 'Compacts automatically at 160k: 6.4k left'
  }
] as const

type Box = { x: number; y: number; width: number; height: number }

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

/** The composer, with room above it for the open card when asked. */
async function shootComposer(page: Page, name: string, withCard = false): Promise<void> {
  if (!SHOTS_DIR) {
    return
  }
  const field = await boxOf(page.locator('[data-composer-field]'))
  const above = withCard ? CARD_ROOM : SHOT_MARGIN
  await page.screenshot({
    path: path.join(SHOTS_DIR, name),
    // The card's open animation would otherwise be caught half way.
    animations: 'disabled',
    clip: {
      x: field.x - SHOT_MARGIN,
      y: field.y - above,
      width: field.width + 2 * SHOT_MARGIN,
      height: field.height + above + SHOT_MARGIN
    }
  })
}

async function shootWindow(page: Page, name: string): Promise<void> {
  if (SHOTS_DIR) {
    await page.screenshot({ path: path.join(SHOTS_DIR, name) })
  }
}

/** Records, from now on, whether the ring was ever out of the page, however briefly. */
function watchRingPresence(page: Page): Promise<JSHandle<{ left: boolean }>> {
  return page.evaluateHandle(() => {
    const presence = { left: false }
    new MutationObserver(() => {
      presence.left ||= document.querySelector('[data-native-chat-context-usage]') === null
    }).observe(document.body, { childList: true, subtree: true })
    return presence
  })
}

async function expectRingIsLastControlBeforeSend(
  page: Page,
  ring: Locator,
  send: Locator
): Promise<void> {
  const field = await boxOf(page.locator('[data-composer-field]'))
  const ringBox = await boxOf(ring)
  const sendBox = await boxOf(send)
  expect(ringBox.x + ringBox.width).toBeLessThanOrEqual(sendBox.x)
  expect(ringBox.y).toBeLessThan(sendBox.y + sendBox.height)
  expect(ringBox.y + ringBox.height).toBeGreaterThan(sendBox.y)
  expect(ringBox.x + ringBox.width / 2).toBeGreaterThan(field.x + field.width / 2)
  expect(ringBox.y + ringBox.height / 2).toBeGreaterThan(field.y + field.height / 2)
  const nearestToSend = await page
    .locator('[data-composer-field] [data-composer-control]:not([aria-hidden])')
    .evaluateAll(
      (controls, sendLeft) =>
        controls
          .map((control) => ({
            id: control.getAttribute('data-composer-control'),
            right: control.getBoundingClientRect().right
          }))
          .filter((control) => control.right <= sendLeft)
          .sort((a, b) => b.right - a.right)[0]?.id,
      sendBox.x
    )
  expect(nearestToSend).toBe('context')
}

test.describe('context indicator', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('the ring starts empty, warns as a Claude chat fills, and compacts from its card', async ({
    orcaPage: page,
    claudeStub
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    // The star prompt opens beside the composer after the first reply.
    await page.evaluate(() => window.api.ui.set({ starNagCompleted: true }))
    const { composer, send } = await openStubChat(page, claudeStub.command)
    const ring = page.locator('[data-native-chat-context-usage]')
    const ringText = page.locator('[data-native-chat-context-text]')
    const card = page.locator('[data-native-chat-context-card]')
    const compactNow = card.locator('[data-native-chat-context-compact]')
    const closeCard = async (): Promise<void> => {
      // The card covers the middle of the editor, so press its near corner.
      await composer.click({ position: { x: 8, y: 8 } })
      await expect(card).toBeHidden()
    }

    await expect(ring).toHaveAttribute('data-native-chat-context-state', 'unknown')
    await expect(ringText).toHaveCount(0)
    await shootComposer(page, 'empty-ring.png')
    await ring.click()
    await expect(card).toContainText('Context usage appears after the first reply.')
    await expect(compactNow).toHaveCount(0)
    await shootComposer(page, 'empty-popover.png', true)
    await closeCard()
    const ringPresence = await watchRingPresence(page)

    for (const level of LEVELS) {
      await page.keyboard.type(`prompt ${level.name}`)
      await send.click()
      await expect(ring).toHaveAttribute('data-native-chat-context-usage', level.percent, {
        timeout: 30_000
      })
      await expect(ring).toHaveAttribute('data-native-chat-context-state', level.state)
      await expect(ring).not.toHaveAttribute('data-native-chat-context-usage-estimated', 'true')
      if (level.text === null) {
        await expect(ringText).toHaveCount(0)
      } else {
        await expect(ringText).toBeVisible()
        await expect(ringText).toHaveText(level.text)
      }
      await expectRingIsLastControlBeforeSend(page, ring, send)
      await shootComposer(page, `${level.name}-ring.png`)
      await shootWindow(page, `${level.name}-window.png`)

      await ring.click()
      await expect(card).toContainText(level.usage)
      await expect(card).toContainText(level.distance)
      if (level.text !== null) {
        await expect(card).toContainText(level.text)
      }
      await expect(compactNow).toHaveText('Compact now')
      await expect(compactNow).toBeEnabled()
      await shootComposer(page, `${level.name}-popover.png`, true)
      await closeCard()
    }

    await ring.click()
    await compactNow.click()
    await expect(ring).toHaveAttribute('data-native-chat-context-state', 'compacting')
    await expect(ringText).toHaveText('Compacting…')
    await expect(card).toContainText('Compacting…')
    await expect(compactNow).toBeDisabled()
    await shootComposer(page, 'compacting.png', true)

    writeFileSync(`${claudeStub.launchLog}.finish-compaction`, '')
    await expect(ring).toHaveAttribute('data-native-chat-context-state', 'compacted', {
      timeout: 30_000
    })
    await expect(ring).toHaveAttribute('data-native-chat-context-usage', '10')
    await expect(ringText).toHaveText('Compacted')
    await closeCard()
    await expectRingIsLastControlBeforeSend(page, ring, send)
    await shootComposer(page, 'compacted-ring.png')

    await ring.click()
    await expect(card).toContainText('20k of 200k tokens (10%)')
    await expect(card).toContainText('Compacts automatically at 160k: 140k left')
    await expect(card).toContainText('Compacted 1 time,')
    await shootComposer(page, 'compacted-popover.png', true)
    expect(await ringPresence.evaluate((presence) => presence.left)).toBe(false)
  })
})
