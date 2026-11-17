// A chat on a Seal server is listed from that server's own registry under the desktop's machine record, also after a desktop restart.
import { randomUUID } from 'node:crypto'
import type { NativeChatMessage } from '../../src/shared/native-chat/native-chat-types'
import { expect, test } from './helpers/orca-app'
import {
  relaunchManagedApp,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'
import { callEnvironment } from './helpers/paired-host-terminal'
import {
  expectOneChat,
  SERVER_STUB_REQUESTS,
  startServerStubChat
} from './helpers/paired-server-stub-chat'
import { sidebarMachineSessionRows } from './helpers/sidebar-session-row'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

// The stub keeps a turn whose prompt says "slow" open for a minute, then replies.
const FIRST_PROMPT = 'slow walk'

/** What the user and the agent said, in order: `role:text`. */
function said(messages: NativeChatMessage[]): string[] {
  return messages.flatMap((message) =>
    message.role === 'user' || message.role === 'assistant'
      ? message.blocks.flatMap((block) =>
          block.type === 'text' ? [`${message.role}:${block.text}`] : []
        )
      : []
  )
}

test('a chat on a Seal server is listed and read under its machine, and again after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Installing the server on the Docker host and two one-minute stub turns come before the last check.
  test.setTimeout(10 * 60_000)
  await withManagedHost(testInfo, async (fixture) => {
    const { session } = fixture
    const started = await startServerStubChat(fixture, FIRST_PROMPT)
    const { environmentId, hostId, exec } = started
    let page = started.page

    // The workspace's card lists the chat at once from this window's own feed, as the full row.
    const cardRows = page.locator(
      `[data-workspace-session-rows="${started.worktreeId}"] [data-live-session-row]`
    )
    await expect(cardRows).toHaveCount(1, { timeout: 5_000 })
    await expect(cardRows).toHaveAttribute('data-status', 'working')
    await expect(cardRows).toContainText(FIRST_PROMPT)
    await expect(cardRows.locator('[data-live-session-machine]')).toBeVisible()

    const working = await expectOneChat(session.userDataDir, hostId, 'working')
    // The server's record takes the row over: still one, under the record's id.
    await expect(cardRows).toHaveAttribute('data-live-session-row', working.id)
    await expect(cardRows).toHaveCount(1)
    expect(working.id.startsWith(`${hostId}:claude:`), working.id).toBe(true)
    expect(working).toMatchObject({
      machine: { hostId, kind: 'remote', executionHostId: `runtime:${environmentId}` },
      origin: 'seal',
      surface: { kind: 'chat' }
    })
    // The server's own route: the desktop forwards a send, it never types into a pane.
    expect(working.inputRoutes.map((route) => route.kind)).toEqual(['structured'])

    const finished = await expectOneChat(session.userDataDir, hostId, 'your-turn')
    expect(finished).toMatchObject({ lastMessage: 'Stub reply.', surface: working.surface })
    // The desktop adds nothing of its own to that machine: its list is the server's.
    const onServer = await callEnvironment(page, environmentId, 'liveSessions.list', undefined)
    expect(onServer).toMatchObject({
      sessions: [{ id: finished.id.replace(`${hostId}:`, 'local:'), machine: { hostId: 'local' } }]
    })

    // The chat's history is a journal on the server: the desktop reads it through the server.
    const history = await page.evaluate(
      (sessionId) => window.api.liveSessions.transcriptPage({ sessionId }),
      finished.id
    )
    expect(history.sessionId).toBe(finished.id)
    expect(said(history.messages)).toEqual([`user:${FIRST_PROMPT}`, 'assistant:Stub reply.'])

    await page.evaluate(() => window.__store?.getState().setActiveView('home'))
    await expect(sidebarMachineSessionRows(page, hostId)).toHaveCount(1)
    await expect(sidebarMachineSessionRows(page, hostId)).toContainText(FIRST_PROMPT)
    await page.screenshot({ path: testInfo.outputPath('sidebar-sessions-before-restart.png') })

    page = await relaunchManagedApp(fixture)
    const relisted = await expectOneChat(session.userDataDir, hostId, 'your-turn')
    expect(relisted).toMatchObject({
      id: finished.id,
      machine: { hostId, kind: 'remote' },
      surface: finished.surface,
      lastMessage: 'Stub reply.'
    })
    await page.evaluate(() => window.__store?.getState().setActiveView('home'))
    await expect(sidebarMachineSessionRows(page, hostId)).toHaveCount(1)
    await expect(sidebarMachineSessionRows(page, hostId)).toContainText(FIRST_PROMPT)
    await page.screenshot({ path: testInfo.outputPath('sidebar-sessions-after-restart.png') })

    // Opening the row shows the conversation, read from the server and followed as it grows.
    await sidebarMachineSessionRows(page, hostId).click()
    const transcript = page.locator(`[data-live-session-pane="${relisted.id}"]`)
    await expect(transcript).toContainText('Stub reply.', { timeout: 60_000 })
    await page.screenshot({ path: testInfo.outputPath('server-chat-transcript.png') })
    // The rows the open view's watch delivers from here on, kept in the window.
    const followed = await page.evaluateHandle((sessionId) => {
      const rows: NativeChatMessage[] = []
      window.api.liveSessions.onTranscriptDelta(({ delta }) => {
        if (delta.sessionId === sessionId) {
          rows.push(...delta.messages)
        }
      })
      return rows
    }, relisted.id)

    // A send from the desktop, by the desktop's id, reaches the agent on the server.
    const sent = await page.evaluate(
      (params) => window.api.runtime.call({ method: 'liveSessions.send', params }),
      { sessionId: relisted.id, messageId: randomUUID(), text: 'slow swim' }
    )
    expect(sent, JSON.stringify(sent)).toMatchObject({
      ok: true,
      result: { sessionId: relisted.id, error: null }
    })
    await expectOneChat(session.userDataDir, hostId, 'working')
    // The server lists the turn before its agent has read it.
    await expect.poll(() => exec(`grep -c '"type":"user"' ${SERVER_STUB_REQUESTS}`)).toBe('2')
    // The open view's watch on the server delivers the new turn; nothing here reads a file.
    await expect
      .poll(async () => said(await followed.jsonValue()), {
        timeout: 60_000,
        message: "the server chat's new turn never reached the open transcript"
      })
      .toContain('user:slow swim')
    await expect(transcript).toContainText('slow swim')
    await page.screenshot({ path: testInfo.outputPath('server-chat-transcript-followed.png') })
  })
})
