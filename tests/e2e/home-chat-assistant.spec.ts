import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Locator, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { startFakeChatCompletionsServer } from '../../src/main/home-chat/testing/fake-chat-completions-server.test-support'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  GPU_STATUS_LINES,
  KESSEL,
  KESSEL_STATUS_LINE,
  SCRIPTED_SUMMARY,
  scriptedHomeChatModel,
  unansweredToolCalls
} from './helpers/home-chat-scripted-model'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'

const LOG_PARTS = 6
const FIRST_ASK = 'Reach out to kessel-ml and tell me the status of kessel-ml.'
const INTERNAL_MARKUP = [
  'Automatic note from Seal',
  'Summary of the earlier part of this conversation',
  'earlier_conversation'
]

function seedKesselHome(home: string): void {
  const skill = path.join(home, '.claude', 'skills', 'gpu-check')
  mkdirSync(skill, { recursive: true })
  mkdirSync(path.join(home, 'logs'), { recursive: true })
  mkdirSync(path.join(home, 'scratch'), { recursive: true })
  writeFileSync(path.join(home, 'kessel-status.txt'), `${KESSEL_STATUS_LINE}\n`)
  writeFileSync(path.join(home, 'gpu-status.txt'), `${GPU_STATUS_LINES.join('\n')}\n`)
  writeFileSync(
    path.join(skill, 'SKILL.md'),
    '---\nname: gpu-check\ndescription: Check GPU health on the training rig\n---\nRead ~/gpu-status.txt on this machine and report each GPU temperature and load.\n'
  )
  for (let part = 1; part <= LOG_PARTS; part++) {
    const line = (step: number): string =>
      `part-${part}-line step=${String(step).padStart(5, '0')} loss=0.${part}${step % 10} lr=3e-4 grad_norm=1.0${step % 7}`
    writeFileSync(
      path.join(home, 'logs', `part-${part}.log`),
      `${Array.from({ length: 80 }, (_, step) => line(step)).join('\n')}\n`
    )
  }
}

function seedLocalHome(home: string): void {
  const skill = path.join(home, '.claude', 'skills', 'deploy-checklist')
  mkdirSync(skill, { recursive: true })
  writeFileSync(
    path.join(skill, 'SKILL.md'),
    '---\nname: deploy-checklist\ndescription: Steps before shipping a release\n---\nRun the tests, then tag.\n'
  )
  writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'Prefer pnpm over npm.\n')
}

function chatPanel(page: Page): Locator {
  return page.locator('[data-home-slot="chat"]')
}

async function openHome(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.__store?.getState().repos.length ?? 0), {
      timeout: 60_000
    })
    .toBeGreaterThan(0)
  await page.evaluate(() => window.__store?.getState().setActiveView('home'))
  await expect(chatPanel(page).getByRole('textbox', { name: 'Message' })).toBeVisible()
}

async function ask(page: Page, text: string): Promise<void> {
  const box = chatPanel(page).getByRole('textbox', { name: 'Message' })
  await box.fill(text)
  await box.press('Enter')
}

/** The turn is over once the answer is on screen and the stop button has made way for send. */
async function expectAnswer(page: Page, text: string): Promise<void> {
  await expect(chatPanel(page).getByText(text, { exact: false })).toBeVisible({ timeout: 60_000 })
  await expect(page.locator('[data-home-chat-stop]')).toHaveCount(0)
}

async function activeChat(page: Page): Promise<{ id: string; usedTokens: number }> {
  return page.evaluate(async (title) => {
    const chats = await window.api.homeChat!.list()
    const chat = chats.find((candidate) => candidate.title !== title) ?? chats[0]
    return { id: chat.id, usedTokens: chat.context.usedTokens }
  }, FIRST_ASK)
}

function toolCard(page: Page, tool: string): Locator {
  return chatPanel(page).locator(`[data-tool-name="${tool}"]`)
}

async function shot(page: Page, testInfo: TestInfo, name: string, target?: Locator): Promise<void> {
  const dir = process.env.SEAL_HOME_CHAT_SCREENSHOT_DIR
  const file = dir ? path.join(dir, `${name}.png`) : testInfo.outputPath(`${name}.png`)
  // Popovers fade in; capture their settled state.
  await (target ?? page).screenshot({ path: file, animations: 'disabled' })
}

async function expectNoInternalMarkup(page: Page): Promise<void> {
  const text = await chatPanel(page).innerText()
  for (const marker of INTERNAL_MARKUP) {
    expect(text).not.toContain(marker)
  }
}

test('the Home assistant works on a paired machine, loads skills, compacts and survives a restart', async ({
  testRepoPath
}, testInfo) => {
  // Starts a Seal server, launches the app twice, and runs a dozen assistant turns in between.
  test.setTimeout(300_000)
  const model = await startFakeChatCompletionsServer(scriptedHomeChatModel)
  const host = await launchHeadlessPairedRuntimeHost({ extraEnv: { SHELL: '/bin/bash' } })
  let client: PairedElectronClient | null = null
  try {
    if (!host.env.HOME) {
      throw new Error('The headless host launched without an isolated HOME')
    }
    seedKesselHome(host.env.HOME)
    // Home only replaces first-run onboarding once a project exists.
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' })
    client = await launchPairedElectronClient(host.offer, testInfo, KESSEL)
    let page = client.page
    seedLocalHome(await client.app.evaluate(({ app }) => app.getPath('home')))
    await page.evaluate(
      (baseUrl) =>
        window.api.homeChat!.updateSettings({
          defaultBackend: 'openai-compatible',
          openai: { baseUrl, model: 'scripted-model', contextWindow: 200_000 }
        }),
      model.baseUrl
    )
    await openHome(page)

    // Reach a machine by name and run a command there.
    await ask(page, FIRST_ASK)
    await expectAnswer(page, `Its status file says: ${KESSEL_STATUS_LINE}`)
    await expect(toolCard(page, 'run_command')).toHaveAttribute('data-tool-status', 'ok')
    await expect(page.locator(`[data-home-chat-machine="${KESSEL}"]`)).toBeVisible()
    expect(model.requests[0].messages[0].content).toContain('deploy-checklist')
    await toolCard(page, 'run_command').getByRole('button').first().click()
    await expect(toolCard(page, 'run_command').getByText(KESSEL_STATUS_LINE)).toBeVisible()
    await shot(page, testInfo, '01-command-on-kessel-ml', chatPanel(page))
    await toolCard(page, 'run_command').getByRole('button').first().click()

    // Find and load a skill that lives on that machine, then follow it.
    await ask(page, 'Check the GPUs on kessel-ml the way its skill says.')
    await expectAnswer(page, GPU_STATUS_LINES.join('; '))
    await toolCard(page, 'load_skill').getByRole('button').first().click()
    await expect(toolCard(page, 'load_skill').getByText('Read ~/gpu-status.txt')).toBeVisible()
    await toolCard(page, 'load_skill').scrollIntoViewIfNeeded()
    await shot(page, testInfo, '02-skill-loaded-from-kessel-ml', chatPanel(page))
    await toolCard(page, 'load_skill').getByRole('button').first().click()

    // A destructive command waits for approval.
    await ask(page, 'Remove the scratch folder on kessel-ml.')
    const approve = chatPanel(page).getByRole('button', { name: 'Approve' })
    await expect(approve).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('[data-home-chat-stop]')).toBeVisible()
    await shot(page, testInfo, '03-approval-and-stop', chatPanel(page))
    await approve.click()
    await expectAnswer(page, 'The scratch folder on kessel-ml is gone.')
    await page.locator(`[data-home-chat-machine="${KESSEL}"]`).click()
    await expect(page.locator(`[data-home-chat-machine-row="${KESSEL}"]`)).toContainText('Online')
    await shot(page, testInfo, '04-machines-and-context')
    await page.keyboard.press('Escape')

    // A second thread that outgrows the model's window.
    await chatPanel(page).getByRole('button', { name: 'New thread' }).click()
    await ask(page, 'Read part 1 of the training log on kessel-ml.')
    await expectAnswer(page, 'Part 1 is clean')
    const afterOne = await activeChat(page)
    await ask(page, 'Read part 2 of the training log on kessel-ml.')
    await expectAnswer(page, 'Part 2 is clean')
    const afterTwo = await activeChat(page)
    const perExchange = afterTwo.usedTokens - afterOne.usedTokens
    expect(perExchange).toBeGreaterThan(500)
    // Sized so the fifth exchange crosses the threshold.
    const contextWindow = Math.round((afterTwo.usedTokens + perExchange * 2.5) / 0.8)
    await page.evaluate(
      (tokens) => window.api.homeChat!.updateSettings({ openai: { contextWindow: tokens } }),
      contextWindow
    )
    for (const part of [3, 4, 5]) {
      await ask(page, `Read part ${part} of the training log on kessel-ml.`)
      await expectAnswer(page, `Part ${part} is clean`)
    }
    const divider = chatPanel(page).locator('[data-home-chat-compaction]')
    await expect(divider).toHaveCount(1, { timeout: 60_000 })
    await ask(page, 'Which parts have we covered so far?')
    await expectAnswer(page, 'Older parts are covered by my summary.')
    const lastRequest = JSON.stringify(model.requests.at(-1)?.messages)
    expect(lastRequest).toContain(SCRIPTED_SUMMARY)
    expect(lastRequest).not.toContain('part-1-line')
    expect(lastRequest).toContain('part-5-line')
    await expectNoInternalMarkup(page)
    await divider.getByRole('button').click()
    await expect(divider.getByText(SCRIPTED_SUMMARY)).toBeVisible()
    await divider.scrollIntoViewIfNeeded()
    await shot(page, testInfo, '05-compaction-divider', chatPanel(page))
    await page.locator('[data-home-chat-context]').click()
    await expect(page.locator('[data-home-chat-compactions="1"]')).toBeVisible()
    await shot(page, testInfo, '06-context-after-compaction')
    await page.keyboard.press('Escape')

    // Rename from the thread list.
    await chatPanel(page).getByRole('button', { name: 'Threads' }).click()
    const logsRow = page.locator('[data-home-chat-thread]').filter({ hasText: 'Read part 1' })
    await logsRow.hover()
    await logsRow.getByRole('button', { name: 'Rename' }).click()
    const nameBox = page.getByRole('textbox', { name: 'Thread name' })
    await nameBox.fill('Training logs')
    await nameBox.press('Enter')
    await expect(page.locator('[data-home-chat-thread]')).toHaveText([/Training logs/, /Reach out/])
    await shot(page, testInfo, '07-thread-list')
    await page.keyboard.press('Escape')

    // Quit and reopen: both threads, their order, tool calls and the divider come back.
    const { userDataDir } = client
    await client.quitPreservingProfile()
    client = null
    const requestsBeforeRestart = model.requests.length
    client = await launchPairedElectronClient(host.offer, testInfo, KESSEL, {
      reuseUserDataDir: userDataDir
    })
    page = client.page
    await openHome(page)
    await expect(chatPanel(page).getByRole('button', { name: 'Threads' })).toContainText(
      'Training logs'
    )
    await expect(chatPanel(page).locator('[data-home-chat-compaction]')).toHaveCount(1)
    await expect(chatPanel(page).locator('[data-home-chat-user]')).toHaveText([
      ...[1, 2, 3, 4, 5].map((part) => `Read part ${part} of the training log on kessel-ml.`),
      'Which parts have we covered so far?'
    ])
    await expectNoInternalMarkup(page)
    await shot(page, testInfo, '08-after-restart-compacted-thread', chatPanel(page))

    await chatPanel(page).getByRole('button', { name: 'Threads' }).click()
    await page.locator('[data-home-chat-thread]').filter({ hasText: 'Reach out' }).click()
    await expect(chatPanel(page).locator('[data-home-chat-user]')).toHaveText([
      FIRST_ASK,
      'Check the GPUs on kessel-ml the way its skill says.',
      'Remove the scratch folder on kessel-ml.'
    ])
    await expect(chatPanel(page).locator('[data-tool-name]')).toHaveCount(6)
    expect(
      await chatPanel(page)
        .locator('[data-tool-name]')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('data-tool-name')))
    ).toEqual([
      'list_machines',
      'run_command',
      'list_skills',
      'load_skill',
      'run_command',
      'run_command'
    ])

    // The model gets the earlier tool calls and results back in its own format.
    await ask(page, 'What did the status file say?')
    await expectAnswer(page, `Earlier it said: ${KESSEL_STATUS_LINE}`)
    expect(model.requests.length).toBe(requestsBeforeRestart + 1)
    const replayed = model.requests.at(-1)?.messages ?? []
    expect(replayed.filter((message) => message.role === 'tool')).toHaveLength(6)
    expect(unansweredToolCalls(replayed)).toEqual([])
    await shot(page, testInfo, '09-after-restart-resumed-thread', chatPanel(page))
  } finally {
    await client?.dispose()
    await host.dispose()
    await model.close()
  }
})
