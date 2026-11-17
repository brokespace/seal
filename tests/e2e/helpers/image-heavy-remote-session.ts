// A Claude session on another machine whose transcript is mostly screenshots, as a chat's history
// is after a day of pasted and read-back images, and what opening its chat should do with it.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { writeImageHeavyClaudeTranscript } from '../../../config/scripts/performance/session-transcripts/live-transcript-replay-corpus'
import type { LiveSession } from '../../../src/shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../../src/shared/native-chat/native-chat-types'
import {
  clickSidebarSessionRow,
  externalAgentSessionPane,
  showSidebar
} from './agent-session-sidebar-open'
import { readLiveSessions, rescanLiveSessions } from './live-session-registry'
import { cleanupTestRepository } from '../global-teardown'
import { expect } from './orca-app'
import { attachRepoAndOpenTerminal, type createRestartSession } from './orca-restart'
import { createSeededTestRepo } from './seeded-test-repo'
import { waitForSessionReady } from './store'

const TURNS = 40
/** The transcript's last prompt and its first: the newest page holds one and not the other. */
const NEWEST_PROMPT = `Thanks, apply that fix to screen ${TURNS} and keep going.`
const OLDEST_PROMPT = 'Screen 1: what is wrong with this layout?'
/** The most messages one page of history holds. */
const PAGE_MESSAGES = 80

export type ImageHeavyTranscript = {
  providerSessionId: string
  /** Where under the agent's home the transcript goes. */
  relativePath: string
  bytes: Buffer
}

/** The transcript of a session that ran in `cwd` on some machine: tens of megabytes of image. */
export function imageHeavyTranscript(
  cwd: string,
  providerSessionId: string = randomUUID()
): ImageHeavyTranscript {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-image-transcript-'))
  try {
    const file = writeImageHeavyClaudeTranscript(path.join(scratch, 'transcript.jsonl'), {
      turns: TURNS,
      sessionId: providerSessionId,
      cwd
    })
    return {
      providerSessionId,
      relativePath: `.claude/projects/${cwd.replace(/[^A-Za-z0-9]/g, '-')}/${providerSessionId}.jsonl`,
      bytes: readFileSync(file)
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Connects every machine but this one, as the Machines page's Connect does. */
export async function connectRemoteMachines(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (const machine of await window.api.machines!.list()) {
      if (machine.id !== 'local') {
        await window.api.machines!.connect({ machineId: machine.id })
      }
    }
  })
}

async function waitForRemoteSession(page: Page, providerSessionId: string): Promise<LiveSession> {
  let found: LiveSession | undefined
  await expect
    .poll(
      async () => {
        await rescanLiveSessions(page)
        found = (await readLiveSessions(page)).find(
          (session) =>
            session.providerSessionId === providerSessionId && session.machine.kind === 'remote'
        )
        return found !== undefined
      },
      { timeout: 180_000, message: 'the session on the remote machine was never listed' }
    )
    .toBe(true)
  return found!
}

const textOf = (messages: NativeChatMessage[]): string =>
  messages
    .flatMap((message) => message.blocks)
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n')

const imageUrls = (messages: NativeChatMessage[]): string[] =>
  messages
    .flatMap((message) => message.blocks)
    .flatMap((block) => (block.type === 'image-ref' && block.url ? [block.url] : []))

/**
 * The history a chat asks for first: the newest messages only, none of the megabytes of image the
 * transcript holds, and each inline image as a reference the window reads when it shows it.
 */
async function expectNewestPageWithoutImageBytes(page: Page, sessionId: string): Promise<void> {
  const history = await page.evaluate(
    (id) => window.api.liveSessions.transcriptPage({ sessionId: id }),
    sessionId
  )
  expect(textOf(history.messages)).toContain(NEWEST_PROMPT)
  expect(textOf(history.messages)).not.toContain(OLDEST_PROMPT)
  expect(history.more).toBe(true)
  expect(history.messages.length).toBeLessThanOrEqual(PAGE_MESSAGES)
  const urls = imageUrls(history.messages)
  expect(urls.filter((url) => url.startsWith('data:'))).toEqual([])

  const reference = urls.find((url) => url.startsWith('seal-transcript-image:'))
  expect(reference, 'the newest page names no inline image').toBeDefined()
  const image = await page.evaluate((args) => window.api.liveSessions.transcriptImage(args), {
    sessionId,
    url: reference!
  })
  expect(image?.slice(0, 11)).toBe('data:image/')
  // The reference says how much base64 the transcript holds: the image read back is all of it.
  const referenced = Number(/\+(\d+);/.exec(reference!)![1])
  expect(image!.length - image!.indexOf(',') - 1).toBe(referenced)
}

/**
 * Opens the session's chat, restarts the app with that tab open and reconnects its machine. Both
 * times the chat shows the end of the conversation without being sent the rest of it.
 */
export async function expectNewestHistoryBeforeAndAfterRestart(args: {
  testInfo: TestInfo
  session: ReturnType<typeof createRestartSession>
  providerSessionId: string
  /** Adds the machine to the first launch and connects it. */
  addMachine: (app: ElectronApplication, page: Page) => Promise<void>
}): Promise<void> {
  const { testInfo, session, providerSessionId } = args
  // A session's tab opens in a workspace, so the profile needs one.
  const repo = createSeededTestRepo({ publishPath: false })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await attachRepoAndOpenTerminal(first.page, repo)
    await args.addMachine(first.app, first.page)

    const listed = await waitForRemoteSession(first.page, providerSessionId)
    await expectNewestPageWithoutImageBytes(first.page, listed.id)

    await showSidebar(first.page)
    await clickSidebarSessionRow(first.page, listed.id)
    const opened = externalAgentSessionPane(first.page, listed.id)
    await expect(opened).toContainText(NEWEST_PROMPT, { timeout: 60_000 })
    await expect(opened).not.toContainText(OLDEST_PROMPT)
    // An inline image of the newest page is read from the machine once it is on view.
    await expect(opened.locator('img[src^="data:image/"]').first()).toBeVisible({
      timeout: 60_000
    })
    await first.page.screenshot({ path: testInfo.outputPath('history-opened.png') })

    await session.close(app)
    app = null
    const second = await session.launch()
    app = second.app
    const page = second.page
    await waitForSessionReady(page)
    // The tab is back before its machine is: every row the window is sent for it from here on.
    const delivered = await page.evaluateHandle((sessionId) => {
      const rows: unknown[] = []
      window.api.liveSessions.onTranscriptDelta(({ delta }) => {
        if (delta.sessionId === sessionId) {
          rows.push(...delta.messages)
        }
      })
      return rows
    }, listed.id)
    const restored = externalAgentSessionPane(page, listed.id)
    await expect(restored).toBeVisible({ timeout: 60_000 })
    await connectRemoteMachines(page)

    await expect(restored).toContainText(NEWEST_PROMPT, { timeout: 180_000 })
    await expect(restored).not.toContainText(OLDEST_PROMPT)
    // Reconnecting reads one page; it does not replay the conversation from its start.
    expect((await delivered.jsonValue()).length).toBeLessThanOrEqual(PAGE_MESSAGES)
    await page.screenshot({ path: testInfo.outputPath('history-after-restart.png') })
  } finally {
    await session.dispose(app ?? undefined)
    cleanupTestRepository(repo)
  }
}
