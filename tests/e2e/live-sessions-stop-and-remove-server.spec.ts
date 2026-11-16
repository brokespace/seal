// "Stop and remove" on a Seal server's chat takes it off the desktop's list at once; the server stops its agent behind that.
import { stopAndRemoveFromRow } from './helpers/live-session-stop-and-remove'
import { expect, test } from './helpers/orca-app'
import { skipUnlessManagedDockerHost, withManagedHost } from './helpers/orcad-managed-workspace'
import { callEnvironment } from './helpers/paired-host-terminal'
import { expectOneChat, listMachine, startServerStubChat } from './helpers/paired-server-stub-chat'
import { sidebarMachineSessionRows } from './helpers/sidebar-session-row'

skipUnlessManagedDockerHost()
test.skip(process.platform === 'win32', 'The Docker SSH host uses POSIX tooling')

test('a chat at work on a Seal server leaves the list within two seconds of "Stop and remove", then its agent ends', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launch through a restart session.
{}, testInfo) => {
  // Installing the server on the Docker host comes before the first check.
  test.setTimeout(10 * 60_000)
  await withManagedHost(testInfo, async (fixture) => {
    // The stub keeps a turn whose prompt says "slow" open for a minute.
    const { page, environmentId, hostId, exec } = await startServerStubChat(fixture, 'slow walk')
    const { userDataDir } = fixture.session
    await expectOneChat(userDataDir, hostId, 'working')
    // The brackets keep pgrep from finding the shell that runs this very line.
    const agentRuns = (): string =>
      exec("pgrep -f '[o]rca-e2e-claude-stub.cjs' >/dev/null && echo yes || echo no")
    expect(agentRuns()).toBe('yes')

    await page.evaluate(() => window.__store?.getState().setActiveView('home'))
    const row = sidebarMachineSessionRows(page, hostId)
    await expect(row).toHaveCount(1)
    await stopAndRemoveFromRow(page, row, testInfo)

    await expect.poll(agentRuns, { timeout: 30_000 }).toBe('no')
    // The server keeps the chat for its other clients, ended; this desktop hides it for good.
    const onServer = await callEnvironment(page, environmentId, 'liveSessions.list', undefined)
    expect(onServer).toMatchObject({ sessions: [{ surface: { kind: 'chat' }, alive: false }] })
    expect((await listMachine(userDataDir, hostId)).sessions).toEqual([])
    await expect(row).toHaveCount(0)
  })
})
