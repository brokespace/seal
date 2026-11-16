// Gives a Docker systemd SSH host the Seal server its user would run: the server-only archive, `seal` on the
// login PATH, and the service `seal serve service install` registers.
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { DockerSystemdSshHost } from './docker-ssh-host-systemd-target'
import { runDockerSshHostProcess } from './docker-ssh-host-target'

const PACK_SERVER_ARCHIVE = path.resolve(
  'config/scripts/orcad-distribution/server-artifact/pack-orcad-server-artifact.mjs'
)
const ARCHIVE_ON_HOST = '/tmp/seal-server.tar.gz'
// Outside ~/.orca-remote, which only a server Seal installs may create.
const INSTALL_DIR = '/home/seal/seal-server'
// ~/.local/bin is on the PATH of the user's login shell once it exists.
const SEAL_COMMAND = '/home/seal/.local/bin/seal'

/**
 * Installs the server from the template and starts it as `seal-serve.service` on 127.0.0.1:6768.
 * Needs a host started with `linger: true`, as only then does the user's manager run before a login.
 */
export function installOwnSealServe(host: DockerSystemdSshHost, templateDir: string): void {
  const workDir = mkdtempSync(path.join(os.tmpdir(), 'seal-own-serve-'))
  try {
    const packed = runDockerSshHostProcess(
      process.execPath,
      [
        PACK_SERVER_ARCHIVE,
        '--template',
        templateDir,
        '--target',
        'linux-x64-glibc',
        '--out-dir',
        workDir
      ],
      { timeoutMs: 180_000 }
    )
    const { archive }: { archive: string } = JSON.parse(packed.slice(packed.lastIndexOf('\n') + 1))
    runDockerSshHostProcess('docker', ['cp', archive, `${host.containerName}:${ARCHIVE_ON_HOST}`], {
      timeoutMs: 60_000
    })
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
  host.exec(
    `mkdir -p ${INSTALL_DIR} ${path.posix.dirname(SEAL_COMMAND)} && ` +
      `tar -xzf ${ARCHIVE_ON_HOST} -C ${INSTALL_DIR} --strip-components=1 && ` +
      `ln -s ${INSTALL_DIR}/bin/orca-ide ${SEAL_COMMAND} && ` +
      // A login shell, so the service gets the PATH the user's own sessions have.
      `bash -lc '${SEAL_COMMAND} serve service install --command ${SEAL_COMMAND}'`,
    { user: 'seal', timeoutMs: 120_000 }
  )
  host.exec(`rm -f ${ARCHIVE_ON_HOST}`)
}

/** The link `seal pair` prints on the host, which its user pastes into another computer's Seal. */
export function ownSealServePairingLink(host: DockerSystemdSshHost): string {
  const printed = host.exec(`bash -lc '${SEAL_COMMAND} pair --json'`, { user: 'seal' })
  const answer: { result: { pairingUrl: string } } = JSON.parse(
    printed.slice(printed.indexOf('{'), printed.lastIndexOf('}') + 1)
  )
  return answer.result.pairingUrl
}
