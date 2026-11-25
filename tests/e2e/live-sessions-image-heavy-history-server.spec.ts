// A long, image-heavy Claude session on a paired Seal server: its chat opens on the newest messages, and again after the app restarts and reconnects.
import { writeFileSync } from 'node:fs'
import { test } from '@stablyai/playwright-test'
import { seedExternalClaudeSession } from './helpers/external-claude-session'
import { launchHeadlessPairedRuntimeHost } from './helpers/headless-paired-runtime-host'
import {
  connectRemoteMachines,
  expectNewestHistoryBeforeAndAfterRestart,
  imageHeavyTranscript
} from './helpers/image-heavy-remote-session'
import { createRestartSession } from './helpers/orca-restart'

test.skip(process.platform === 'win32', 'Sessions are not scanned for on Windows')

test('a chat on a Seal server opens on its newest messages without its images, also after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launches through a restart session.
{}, testInfo) => {
  // Starts a paired server and launches the app twice.
  test.setTimeout(10 * 60_000)
  const host = await launchHeadlessPairedRuntimeHost()
  // The session runs on the server: its process and its transcript are under the server's home.
  const claude = await seedExternalClaudeSession(host.app)
  try {
    writeFileSync(
      claude.transcriptPath,
      imageHeavyTranscript(claude.cwd, claude.providerSessionId).bytes
    )
    await expectNewestHistoryBeforeAndAfterRestart({
      testInfo,
      session: createRestartSession(testInfo),
      providerSessionId: claude.providerSessionId,
      addMachine: async (_app, page) => {
        await page.evaluate(async (pairingCode) => {
          await window.api.runtimeEnvironments.addFromPairingCode({
            name: 'server-box',
            pairingCode
          })
          window
            .__store!.getState()
            .setRuntimeEnvironments(await window.api.runtimeEnvironments.list())
        }, host.offer.pairingUrl)
        await connectRemoteMachines(page)
      }
    })
  } finally {
    claude.stop()
    await host.dispose()
  }
})
