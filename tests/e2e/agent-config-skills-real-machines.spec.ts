// The Skills lists of Settings > Agent configuration in the real app, against real machines: an
// account behind a real sshd whose login shell is fish, a paired Seal server, and this computer.
// Each holds skills in every place an agent loads them from.
import { expect, test } from './helpers/orca-app'
import { localSshdUnavailableReason } from './helpers/local-sshd-machines'
import { launchHomeChatOnRealMachines } from './home-chat-tools/real-machine-targets'
import type { Target } from './home-chat-tools/tool-case-types'
import { seedAgentConfig, seedSkillSources } from './agent-config/agent-config-machine-seed'
import {
  openMachineAgentConfig,
  openProjectAgentConfig,
  screenshotter
} from './agent-config/agent-config-page-driver'
import { manageSkills, projectSkills } from './agent-config/agent-config-skills-journey'

test('skills from every source are listed and switched over SSH, a Seal server and locally', async ({
  testRepoPath
}, testInfo) => {
  const unavailable = localSshdUnavailableReason()
  // A developer machine without sudo cannot host the accounts; CI must never skip them.
  test.skip(unavailable !== null && !process.env.CI, unavailable ?? '')
  expect(unavailable, 'CI must be able to run a real sshd').toBeNull()
  // Three machines plus a project, each with real agent CLIs and plugin folders to scan.
  test.setTimeout(10 * 60_000)

  const suite = await launchHomeChatOnRealMachines(testInfo, testRepoPath)
  try {
    const { page, targets, app } = suite.env
    const targetOf = (key: Target['key']): Target => targets.find((item) => item.key === key)!
    const machines = [targetOf('ssh-fish'), targetOf('seal-server'), targetOf('local')]
    for (const target of machines) {
      seedAgentConfig(target, null)
      seedSkillSources(target)
    }
    // Hidden windows have no screen to size themselves to.
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 1000)
    )
    const shot = screenshotter(page, testInfo)

    for (const target of machines) {
      await test.step(`${target.key}: skills of each agent`, async () => {
        await manageSkills(
          { page, target, shot },
          await openMachineAgentConfig(
            page,
            // The picker names this computer after its system, not after its user.
            target.key === 'local' ? /^Local / : target.label
          )
        )
      })
    }

    await test.step('a project on the Seal server', async () => {
      const server = targetOf('seal-server')
      const path = `${server.home}/work/app`
      await suite.server.client.call('repo.add', { path, kind: 'folder' })
      await page.evaluate(() => window.__store!.getState().fetchReposForAllHosts())
      const repoId = (): Promise<string | null> =>
        page.evaluate(
          (repoPath) =>
            window.__store?.getState().repos.find((repo) => repo.path === repoPath)?.id ?? null,
          path
        )
      await expect.poll(repoId, { timeout: 60_000 }).not.toBeNull()
      await projectSkills(
        { page, target: server, shot },
        await openProjectAgentConfig(page, (await repoId())!)
      )
    })
  } finally {
    await suite.dispose()
  }
})
