// A chat on a Seal server installed on the Docker SSH host, driven by the Claude stub, as its desktop lists it.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import type {
  LiveSession,
  LiveSessionRegistrySnapshot
} from '../../../src/shared/live-sessions/live-session-types'
import { orcaCliResult } from './compiled-orca-cli'
import { expect } from './orca-app'
import { activateManagedWorkspace, type ManagedHostFixture } from './orcad-managed-workspace'
import { callEnvironment } from './paired-host-terminal'
import { installSealServerOverSshTarget } from './seal-server-install-machine'
import { waitForSessionReady } from './store'

const STUB = readFileSync(
  path.join(process.cwd(), 'tests', 'e2e', 'fixtures', 'structured-claude-stub.cjs')
)
export const SERVER_STUB_REQUESTS = '/tmp/orca-e2e-claude-launches.jsonl.requests.jsonl'
const WRAPPER = `#!/bin/sh
exec /usr/local/bin/node /usr/local/lib/orca-e2e-claude-stub.cjs /tmp/orca-e2e-claude-launches.jsonl "$@"
`
export const SERVER_TURN_TIMEOUT_MS = 120_000

type MachineListing = { sessions: LiveSession[]; error: string | null }

/** What `seal sessions list --all` shows under one machine, with that machine's notice. */
export async function listMachine(userDataDir: string, hostId: string): Promise<MachineListing> {
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
export async function expectOneChat(
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
      { timeout: SERVER_TURN_TIMEOUT_MS, message: `the machine never listed one chat as ${status}` }
    )
    .toEqual([`chat:${status}`])
  expect(listing.error, 'a federated machine carries no notice').toBeNull()
  return listing.sessions[0]!
}

/**
 * Installs the stub and a Seal server on the fixture's host, opens the server's workspace and
 * sends `prompt` in a new chat there. The stub keeps a turn whose prompt says "slow" open for a
 * minute, then replies.
 */
export async function startServerStubChat(
  fixture: ManagedHostFixture,
  prompt: string
): Promise<{
  page: Page
  environmentId: string
  /** The server's machine record on the desktop. */
  hostId: string
  exec: NonNullable<ManagedHostFixture['host']['exec']>
}> {
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
  const page = launched.page
  await waitForSessionReady(page)

  // Seal installs no server on connect; this sends what the install confirmation sends.
  const targetId = await page.evaluate(
    async (input) => (await window.api.ssh.addTarget({ target: input })).target.id,
    host.input
  )
  const installed = await installSealServerOverSshTarget(page, targetId)
  const machine = (await page.evaluate(() => window.api.machines!.list())).find(
    (entry) => entry.ssh?.targetId === targetId
  )
  expect(machine, `the server is a machine (${installed.reason})`).toMatchObject({
    connection: 'server'
  })
  const environmentId = machine!.server!.environmentId
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
  await page.keyboard.type(prompt)
  await chat.getByRole('button', { name: 'Send', exact: true }).click()
  return { page, environmentId, hostId, exec }
}
