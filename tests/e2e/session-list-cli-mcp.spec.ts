// `seal sessions list` and the MCP session tools read the one registry: a chat and an outside session alike.
import path from 'node:path'
import { expect } from './helpers/orca-app'
import { orcaCliResult, runCompiledOrcaCli } from './helpers/compiled-orca-cli'
import { addMcpClient, connectMcpOverStdio, openMcpSettings } from './helpers/seal-mcp-client'
import {
  seedLiveSession,
  stopAllSeededSessions,
  waitForLiveSessions
} from './helpers/seeded-live-sessions'
import { addSeedWorkspaces, removeSeedWorkspaces } from './helpers/seeded-workspaces'
import { SUPPORTED, openStubChat, test } from './helpers/structured-claude-stub'
import type { LiveSessionRegistrySnapshot } from '../../src/shared/live-sessions/live-session-types'

function toolText(
  result: Awaited<ReturnType<Awaited<ReturnType<typeof connectMcpOverStdio>>['callTool']>>
): string {
  const content: unknown = result.content
  return Array.isArray(content)
    ? content
        .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
        .join('\n')
    : ''
}

test.describe('session lists outside the window', () => {
  test.skip(!SUPPORTED, 'the Claude stub wrapper is POSIX-only')

  test.afterEach(async () => {
    await stopAllSeededSessions()
  })

  test('the CLI filters by machine and project, and MCP lists a chat and messages it', async ({
    orcaPage: page,
    electronApp,
    claudeStub
  }) => {
    // A chat turn, an outside session settling over scans, eight CLI runs and an MCP client.
    test.setTimeout(300_000)
    const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const [workspace] = await addSeedWorkspaces(page, 1)
    try {
      const chat = await openStubChat(page, claudeStub.command)
      await page.keyboard.type('first message')
      await chat.send.click()
      await expect(chat.reply).toBeVisible({ timeout: 30_000 })
      const outside = await seedLiveSession(electronApp, {
        cwd: workspace.path,
        status: 'working',
        title: 'Seeded outside work'
      })
      await waitForLiveSessions(page, { [outside.id]: 'working' })

      const list = (...flags: string[]): Promise<LiveSessionRegistrySnapshot> =>
        orcaCliResult<LiveSessionRegistrySnapshot>(userDataDir, ['sessions', 'list', ...flags])
      const ids = async (...flags: string[]): Promise<string[]> =>
        (await list(...flags)).sessions.map((session) => session.id).sort()

      const chatRecord = (await list()).sessions.find(
        (session) => session.surface.kind === 'chat' && session.surface.sessionId === chat.sessionId
      )
      expect(chatRecord).toMatchObject({ provider: 'claude', surface: { kind: 'chat' } })
      const chatId = chatRecord?.id ?? ''
      const both = [chatId, outside.id].sort()
      const machine = chatRecord?.machine.label ?? ''
      const outsideProject = path.basename(workspace.path)

      expect(await ids()).toEqual(expect.arrayContaining(both))
      expect(await ids('--machine', machine.toUpperCase())).toEqual(expect.arrayContaining(both))
      expect(await ids('--machine', 'local')).toEqual(expect.arrayContaining(both))
      expect(await ids('--machine', 'no-such-machine')).toEqual([])
      expect(await ids('--project', outsideProject)).toEqual([outside.id])
      expect(await ids('--project', outsideProject, '--machine', 'no-such-machine')).toEqual([])

      const table = await runCompiledOrcaCli(userDataDir, [
        'sessions',
        'list',
        '--project',
        outsideProject
      ])
      const [headings, ...rows] = table.stdout.trimEnd().split('\n')
      expect(headings.split(/\s{2,}/)).toEqual([
        'STATUS',
        'AGENT',
        'PROJECT',
        'WORKSPACE',
        'MACHINE',
        'SESSION'
      ])
      expect(rows).toHaveLength(1)
      expect(rows[0].split(/\s{2,}/).slice(0, 5)).toEqual([
        'working',
        'Claude Code',
        outsideProject,
        workspace.path,
        machine
      ])
      expect(rows[0]).toContain(`[${outside.id}]`)

      const settings = await openMcpSettings(page)
      const token = await addMcpClient(page, settings, 'Session reader', ['Sessions'])
      const client = await connectMcpOverStdio(electronApp, token)
      try {
        const listed = toolText(await client.callTool({ name: 'list_sessions', arguments: {} }))
        const entry = (id: string): string =>
          listed.split(/^- /m).find((lines) => lines.startsWith(`${id}\n`)) ?? ''
        expect(entry(chatId)).toContain('a Seal chat')
        expect(entry(chatId)).toContain('title: first message')
        expect(entry(outside.id)).toContain('outside Seal')
        expect(entry(outside.id)).toContain(`project: ${outsideProject}`)

        const sent = await client.callTool({
          name: 'message_session',
          arguments: { session_id: chatId, text: 'second message, from MCP' }
        })
        expect(sent.isError, toolText(sent)).not.toBe(true)
        expect(toolText(sent)).toContain('as a chat message')
        // The chat ran the message as its next turn.
        await expect
          .poll(
            async () => {
              const transcript = toolText(
                await client.callTool({ name: 'read_session', arguments: { session_id: chatId } })
              )
              return [
                transcript.includes('second message, from MCP'),
                transcript.split('Stub reply.').length - 1
              ]
            },
            { timeout: 30_000 }
          )
          .toEqual([true, 2])
      } finally {
        await client.close().catch(() => undefined)
      }
    } finally {
      await stopAllSeededSessions()
      await removeSeedWorkspaces(page, [workspace])
    }
  })
})
