// Settings > Agent configuration in the real app, driven through the page against real machines:
// an account behind a real sshd whose login shell is fish, and a paired Seal server. Every change
// is checked on the machine's own disk, outside Seal.
import { expect, test } from './helpers/orca-app'
import { localSshdUnavailableReason } from './helpers/local-sshd-machines'
import { launchHomeChatOnRealMachines } from './home-chat-tools/real-machine-targets'
import type { Target } from './home-chat-tools/tool-case-types'
import { seedAgentConfig, startHttpMcp } from './agent-config/agent-config-machine-seed'
import { openMachineAgentConfig, screenshotter } from './agent-config/agent-config-page-driver'
import {
  manageDocuments,
  manageMcpServers,
  managePlugins,
  manageSettings,
  restoreFromBackups
} from './agent-config/agent-config-machine-journey'
import { manageCodex } from './agent-config/agent-config-codex-journey'
import { copyBetweenMachines } from './agent-config/agent-config-copy-journey'
import { manageProject } from './agent-config/agent-config-project-journey'

// Real agent CLIs to put on the machines' PATH (colon-separated folders); a shim stands in without.
const REAL_CLI_PATH = process.env.SEAL_E2E_AGENT_CLI_PATH || null

test('agent configuration is managed from Settings over SSH and through a Seal server', async ({
  testRepoPath
}, testInfo) => {
  const unavailable = localSshdUnavailableReason()
  // A developer machine without sudo cannot host the accounts; CI must never skip them.
  test.skip(unavailable !== null && !process.env.CI, unavailable ?? '')
  expect(unavailable, 'CI must be able to run a real sshd').toBeNull()
  test.setTimeout(20 * 60_000)

  const suite = await launchHomeChatOnRealMachines(testInfo, testRepoPath)
  const httpMcp = await startHttpMcp()
  try {
    const { page, targets, app } = suite.env
    const targetOf = (key: Target['key']): Target => targets.find((item) => item.key === key)!
    const overSsh = targetOf('ssh-fish')
    const overServer = targetOf('seal-server')
    const local = targetOf('local')
    for (const target of [overSsh, overServer, local]) {
      seedAgentConfig(target, REAL_CLI_PATH)
    }
    // Hidden windows have no screen to size themselves to.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1000)
    )
    const shot = screenshotter(page, testInfo)

    for (const target of [overSsh, overServer]) {
      await test.step(`${target.key}: every kind of configuration`, async () => {
        const env = { page, target, shot, httpMcpUrl: httpMcp.url, realCli: REAL_CLI_PATH !== null }
        const panel = await openMachineAgentConfig(page, target.label)
        await manageDocuments(env, panel)
        await manageMcpServers(env, panel)
        await managePlugins(env, panel)
        await manageSettings(env, panel)
        await restoreFromBackups(env, panel)
        await manageCodex(env, panel)
      })
    }

    await test.step('copy from the SSH machine to the Seal server', async () => {
      await copyBetweenMachines({ page, shot, from: overSsh, to: overServer })
    })

    await test.step('a project on this computer and one on the Seal server', async () => {
      await manageProject({ page, shot, suite, local, overServer })
    })
  } finally {
    httpMcp.server.close()
    await suite.dispose()
  }
})
