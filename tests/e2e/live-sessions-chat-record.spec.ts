// A chat is one record of the session registry, from its first message to its closed tab.

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect } from './helpers/orca-app'
import { sidebarSessionRow } from './helpers/sidebar-session-row'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import { SUPPORTED, openStubChat, test } from './helpers/structured-claude-stub'
import type {
  LiveSession,
  LiveSessionRegistryEvent,
  LiveSessionRegistrySnapshot
} from '../../src/shared/live-sessions/live-session-types'

declare global {
  // oxlint-disable-next-line typescript-eslint/consistent-type-definitions -- declaration merging requires interface
  interface Window {
    // Every event of the registry's feed since recordRegistryEvents, in the order the window got them.
    __liveSessionEvents?: LiveSessionRegistryEvent[]
  }
}

async function recordRegistryEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const events: LiveSessionRegistryEvent[] = []
    window.__liveSessionEvents = events
    window.api.liveSessions.onEvent((event) => events.push(event))
  })
}

/** The chat's agent processes as the stub logged them: each one's pid and the conversation it was started on. */
function readStubConversations(launchLog: string): { pid: number; conversationId: string }[] {
  if (!existsSync(launchLog)) {
    return []
  }
  return readFileSync(launchLog, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      const { pid, args }: { pid: number; args: string[] } = JSON.parse(line)
      const conversationId = /--(?:session-id|resume)[= ](\S+)/.exec(args.join(' '))?.[1]
      return conversationId ? [{ pid, conversationId }] : []
    })
}

test.describe('live sessions chat record', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test('is one chat record from its first message, through an approval and a question, to its closed tab', async ({
    orcaPage: page,
    electronApp,
    claudeStub
  }, testInfo) => {
    // Seven states of the chat, each read back through the CLI for up to 30 s.
    test.setTimeout(180_000)
    const shotsDir = process.env.SEAL_LIVE_SESSIONS_SHOTS_DIR ?? testInfo.outputPath('shots')
    mkdirSync(shotsDir, { recursive: true })
    const shot = (name: string): Promise<Buffer> =>
      page.screenshot({ path: path.join(shotsDir, `${name}.png`), animations: 'disabled' })
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))

    // New chats start with Full access, which answers an approval before anyone sees it.
    await page.evaluate(async () => {
      await window.__store?.getState().updateSettings({ agentPermissionDefault: 'ask' })
    })
    await recordRegistryEvents(page)
    const chat = await openStubChat(page, claudeStub.command)
    const { sessionId } = chat
    const provisionalId = `local:claude:seal-${sessionId}`

    /** Every record that stands for the chat: by its tab, its conversation or its agent's process. */
    const chatRecords = async (): Promise<LiveSession[]> => {
      const { sessions } = await orcaCliResult<LiveSessionRegistrySnapshot>(userDataDir, [
        'sessions',
        'list',
        '--all'
      ])
      const agents = readStubConversations(claudeStub.launchLog)
      return sessions.filter(
        (session) =>
          (session.surface.kind === 'chat' && session.surface.sessionId === sessionId) ||
          session.providerSessionId === `seal-${sessionId}` ||
          agents.some(
            (agent) =>
              agent.conversationId === session.providerSessionId || agent.pid === session.pid
          )
      )
    }
    /** The chat's one record: a second one, or a route into a terminal pane, fails the match. */
    const listedAs = (
      id: string,
      status: LiveSession['status'],
      more: Record<string, unknown> = {}
    ): Record<string, unknown>[] => [
      {
        id,
        status,
        provider: 'claude',
        origin: 'seal',
        surface: { kind: 'chat', sessionId, tabId: `structured-agent-session-${sessionId}` },
        inputRoutes: [{ kind: 'structured', sessionId }],
        ...more
      }
    ]
    const expectListed = (expected: Record<string, unknown>[]): Promise<void> =>
      expect.poll(chatRecords, { timeout: 30_000 }).toMatchObject(expected)

    // Before its first message the provider has named no conversation.
    await expectListed(listedAs(provisionalId, 'idle', { alive: false }))

    // The stub runs a prompt containing "slow" until it is interrupted.
    await page.keyboard.type('slow')
    await chat.send.click()
    await expect
      .poll(() => readStubConversations(claudeStub.launchLog), { timeout: 30_000 })
      .toHaveLength(1)
    const [{ conversationId }] = readStubConversations(claudeStub.launchLog)
    const id = `local:claude:${conversationId}`
    await expectListed(listedAs(id, 'working', { alive: true }))
    await chat.stop.click()
    await expect(chat.stop).toHaveCount(0, { timeout: 30_000 })
    await expectListed(listedAs(id, 'your-turn'))

    await chat.composer.click()
    await page.keyboard.type('needs-approval asks-question')
    await chat.send.click()
    const approval = page.getByRole('group', { name: 'Allow Bash?' })
    await expect(approval).toBeVisible({ timeout: 30_000 })
    await expectListed(
      listedAs(id, 'needs-permission', {
        alive: true,
        permission: {
          question: expect.stringContaining('touch stub-approved.txt'),
          options: [
            { id: 'allow', label: 'Allow' },
            { id: 'allowForSession', label: 'Allow for this session' },
            { id: 'deny', label: 'Deny' }
          ]
        }
      })
    )
    await shot('chat-approval')
    await approval.getByRole('button', { name: 'Allow', exact: true }).click()

    const question = page
      .getByTestId('native-chat-question-card-title')
      .filter({ hasText: 'Tabs or spaces?' })
    await expect(question).toBeVisible({ timeout: 30_000 })
    await expectListed(listedAs(id, 'waiting-input', { alive: true }))
    await shot('chat-question')
    await page.getByRole('button', { name: /Spaces/ }).click()

    await expect(chat.reply).toBeVisible({ timeout: 30_000 })
    await expectListed(listedAs(id, 'your-turn', { alive: true, lastMessage: 'Stub reply.' }))
    // The sidebar lists the chat under the provider's id only.
    await expect(sidebarSessionRow(page, id)).toHaveCount(1)
    await expect(sidebarSessionRow(page, provisionalId)).toHaveCount(0)
    await shot('chat-finished')

    await chat.tab.locator('[data-tab-close-button="true"]').click()
    await expect(chat.tab).toHaveCount(0)
    await expectListed(listedAs(id, 'done', { alive: false, pid: null }))
    await shot('chat-closed')

    // The provisional record was renamed, not dropped beside a new one.
    const removals = await page.evaluate(
      (ids) =>
        (window.__liveSessionEvents ?? []).filter(
          (event) => event.type === 'remove' && ids.includes(event.sessionId)
        ),
      [provisionalId, id]
    )
    expect(removals).toEqual([
      { type: 'remove', revision: expect.any(Number), sessionId: provisionalId, replacedBy: id }
    ])
  })
})
