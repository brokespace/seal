// A long, image-heavy Claude session on a plain SSH machine: its chat opens on the newest messages, and again after the app restarts and reconnects.
import { expect, test } from '@stablyai/playwright-test'
import {
  connectRemoteMachines,
  expectNewestHistoryBeforeAndAfterRestart,
  imageHeavyTranscript
} from './helpers/image-heavy-remote-session'
import { localSshdUnavailableReason, startLocalSshdMachines } from './helpers/local-sshd-machines'
import { createRestartSession } from './helpers/orca-restart'
import { seedIsolatedSshConfig } from './helpers/ssh-config-host-picker'

const SSH_ALIAS = 'seal-e2e-image-history'
const SSH_USER = 'sealshots'

test.skip(localSshdUnavailableReason() !== null, localSshdUnavailableReason() ?? '')

test('a chat on an SSH machine opens on its newest messages without its images, also after a restart', async (// oxlint-disable-next-line no-empty-pattern -- Owns its app launches through a restart session.
{}, testInfo) => {
  // Starts an sshd, uploads tens of megabytes of transcript and launches the app twice.
  test.setTimeout(10 * 60_000)
  const sshd = await startLocalSshdMachines([{ username: SSH_USER, loginShell: '/bin/bash' }])
  try {
    const user = sshd.users[0]!
    const cwd = `${user.home}/app`
    const transcript = imageHeavyTranscript(cwd)
    user.sh(
      `mkdir -p ${cwd} "$(dirname ~/${transcript.relativePath})" && cat > ~/${transcript.relativePath}`,
      transcript.bytes
    )
    // What a scan lists: a process that `ps` shows as `claude --resume <id>`, in the session's folder.
    user.sh(
      `cd ${cwd} && (setsid perl -e '$0 = shift; sleep 900' 'claude --resume ${transcript.providerSessionId}' </dev/null >/dev/null 2>&1 &)`
    )

    await expectNewestHistoryBeforeAndAfterRestart({
      testInfo,
      session: createRestartSession(testInfo, { SSH_AUTH_SOCK: sshd.agentSocket }),
      providerSessionId: transcript.providerSessionId,
      addMachine: async (app, page) => {
        await seedIsolatedSshConfig(
          app,
          [
            `Host ${SSH_ALIAS}`,
            `  HostName ${sshd.host}`,
            `  Port ${sshd.port}`,
            `  User ${SSH_USER}`,
            `  IdentityFile ${sshd.identityFile}`,
            '  IdentitiesOnly yes',
            '  StrictHostKeyChecking no',
            '  UserKnownHostsFile /dev/null',
            ''
          ].join('\n')
        )
        const added = await page.evaluate(
          async (alias) =>
            (
              await window.api.ssh.addTarget({
                target: {
                  label: alias,
                  configHost: alias,
                  host: alias,
                  port: 22,
                  username: '',
                  source: 'ssh-config'
                }
              })
            ).target.id,
          SSH_ALIAS
        )
        expect(added).toBeTruthy()
        await connectRemoteMachines(page)
      }
    })
  } finally {
    sshd.dispose()
  }
})
