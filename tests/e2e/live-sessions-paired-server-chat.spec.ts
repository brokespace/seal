// A chat on a Seal server is listed from that server's own registry under the desktop's machine record, also after a desktop restart.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import type {
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../src/shared/live-sessions/live-session-types'
import type { NativeChatMessage } from '../../src/shared/native-chat/native-chat-types'
import { orcaCliResult } from './helpers/compiled-orca-cli'
import { expect, test } from './helpers/orca-app'
import {
  activateManagedWorkspace,
  relaunchManagedApp,
  skipUnlessManagedDockerHost,
  withManagedHost
} from './helpers/orcad-managed-workspace'
import { callEnvironment } from './helpers/paired-host-terminal'
import { waitForSessionReady } from './helpers/store'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

const STUB = readFileSync(
  path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'structured-claude-stub.cjs')
)
const STUB_REQUESTS = '/tmp/orca-e2e-claude-launches.jsonl.requests.jsonl'
const WRAPPER = `#!/bin/sh
exec /usr/local/bin/node /usr/local/lib/orca-e2e-claude-stub.cjs /tmp/orca-e2e-claude-launches.jsonl "$@"
`
// The stub keeps a turn whose prompt says "slow" open for a minute, then replies.
const FIRST_PROMPT = 'slow walk'
const TURN_TIMEOUT_MS = 120_000

type MachineListing = { sessions: LiveSession[]; error: string | null }

/** What `seal sessions list --all` shows under one machine, with that machine's notice. */
async function listMachine(userDataDir: string, hostId: string): Promise<MachineListing> {
  const snapshot = await orcaCliResult<LiveSessionRegistrySnapshot>(userDataDir, [
    'sessions',
    'list',
    '--all'
  ])
  return {
    sessions: snapshot.sessions.filter((session) => session.machine.hostId === hostId),
    error: snapshot.hostErrors[hostId] ?? null
  }
}

/** Waits until the machine lists exactly one session, a chat in `status`, and returns that read. */
async function expectOneChat(
  userDataDir: string,
  hostId: string,
  status: LiveSession['status']
): Promise<LiveSession> {
  let listing: MachineListing = { sessions: [], error: null }
  await expect
    .poll(
      async () => {
        listing = await listMachine(userDataDir, hostId)
        return listing.sessions.map((session) => `${session.surface.kind}:${session.status}`)
      },
      { timeout: TURN_TIMEOUT_MS, message: `the machine never listed one chat as ${status}` }
    )
    .toEqual([`chat:${status}`])
  expect(listing.error, 'a federated machine carries no notice').toBeNull()
  return listing.sessions[0]!
}

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

function activeAgentRows(page: Page, hostId: string): ReturnType<Page['locator']> {
  return page
    .getByTestId('active-agents')
    .locator(`[data-active-agents-machine="${hostId}"]`)
    .getByRole('option')
}

test('a chat on a Seal server is listed and read under its machine, and again after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Installing the server on the Docker host and two one-minute stub turns come before the last check.
  test.setTimeout(10 * 60_000)
  await withManagedHost(testInfo, async (fixture) => {
    const { host, session } = fixture
    const exec = host.exec
    if (!exec) {
      throw new Error('the Docker host runs commands as its SSH user')
    }
    exec(
      `echo ${STUB.toString('base64')} | base64 -d > /usr/local/lib/orca-e2e-claude-stub.cjs && ` +
        `echo ${Buffer.from(WRAPPER).toString('base64')} | base64 -d > /usr/local/bin/claude && ` +
        'chmod 755 /usr/local/bin/claude'
    )
    const launched = await session.launch()
    fixture.app = launched.app
    let page = launched.page
    await waitForSessionReady(page)

    // Seal converts no SSH machine on connect; this is what "Set up Seal on an SSH host" calls.
    const deployed = await page.evaluate(async (input) => {
      const { target } = await window.api.ssh.addTarget({ target: input })
      return window.api.runtimeEnvironments.managedOrcad!.deploy({
        name: 'Docker Seal server',
        sshTargetId: target.id
      })
    }, host.input)
    if (!('environment' in deployed)) {
      throw new Error(`The server was not installed: ${JSON.stringify(deployed)}`)
    }
    const environmentId = deployed.environment.id
    const machine = (await page.evaluate(() => window.api.machines!.list())).find(
      (entry) => entry.server?.environmentId === environmentId
    )
    expect(machine, 'the server is a machine').toMatchObject({ connection: 'server' })
    const hostId = machine!.recordId
    expect(hostId).not.toBe('local')

    await callEnvironment(page, environmentId, 'repo.add', {
      path: host.remoteRepoPath,
      kind: 'git'
    })
    let worktreeId = ''
    await expect
      .poll(
        async () =>
          (worktreeId = await page.evaluate(
            ({ repoPath, hostId }) =>
              Object.values(window.__store!.getState().worktreesByRepo)
                .flat()
                .find((worktree) => worktree.path === repoPath && worktree.hostId === hostId)?.id ??
              '',
            { repoPath: host.remoteRepoPath, hostId: `runtime:${environmentId}` }
          )),
        { timeout: 60_000, message: "the server's workspace never reached the desktop" }
      )
      .not.toBe('')
    await activateManagedWorkspace(page, worktreeId, environmentId)
    await page.evaluate(async () => {
      await window.__store?.getState().updateSettings({
        nativeChatProviders: { claude: true, codex: true },
        defaultTuiAgent: 'claude',
        claudeCodeThemeSyncOffer: 'settled'
      })
    })
    await page.getByRole('button', { name: 'New tab', exact: true }).first().click()
    await page.getByText('Claude', { exact: true }).first().click({ timeout: 60_000 })
    const chat = page.locator('[data-native-chat-root="true"]')
    await expect(chat).toBeVisible({ timeout: 60_000 })
    await chat.getByRole('textbox').click()
    await page.keyboard.type(FIRST_PROMPT)
    await chat.getByRole('button', { name: 'Send', exact: true }).click()

    const working = await expectOneChat(session.userDataDir, hostId, 'working')
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
    await expect(activeAgentRows(page, hostId)).toHaveCount(1)
    await expect(activeAgentRows(page, hostId)).toContainText(FIRST_PROMPT)
    await page.screenshot({ path: testInfo.outputPath('active-agents-before-restart.png') })

    page = await relaunchManagedApp(fixture)
    const relisted = await expectOneChat(session.userDataDir, hostId, 'your-turn')
    expect(relisted).toMatchObject({
      id: finished.id,
      machine: { hostId, kind: 'remote' },
      surface: finished.surface,
      lastMessage: 'Stub reply.'
    })
    await page.evaluate(() => window.__store?.getState().setActiveView('home'))
    await expect(activeAgentRows(page, hostId)).toHaveCount(1)
    await expect(activeAgentRows(page, hostId)).toContainText(FIRST_PROMPT)
    await page.screenshot({ path: testInfo.outputPath('active-agents-after-restart.png') })

    // Opening the row shows the conversation, read from the server and followed as it grows.
    await activeAgentRows(page, hostId).click()
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
    expect(exec(`grep -c '"type":"user"' ${STUB_REQUESTS}`)).toBe('2')
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
