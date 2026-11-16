import { randomUUID } from 'node:crypto'
import { orcadNodePtyNativeArtifacts, orcadRipgrepArtifact } from '../../../shared/orcad-artifacts'
import { orcadAgentBrowserNativeName } from '../../../shared/orcad-agent-browser-name'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteOrcadNodeRuntime } from './orcad-remote-node-runtime'
import { recordedRemoteNodeRuntimeProbeCommand } from './orcad-remote-node-runtime-recorded-probe'
import { cachedOrcadSlotInstalled } from './orcad-remote-install-cached-probe'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { isWslOrcadHostTarget, type OrcadHostTransport } from './orcad-host-transport'
import { installLockWait } from './install-lock-wait-policy'
import { readBoundedOrcadRemoteRecord } from './orcad-remote-record-file'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/remote-host/ssh-remote-platform'
import { ORCAD_INSTALL_MODEL } from './remote-install-model'
import { acquireInstallLock, type InstallLockExitedOwnerProof } from './remote-install-lock'
import { ORCAD_FENCE_OWNER_FILENAME } from '../activation/orcad-activation-fence-scope'
import { forgetHeldOrcadFence, rememberHeldOrcadFence } from '../activation/orcad-held-fence-tokens'
import { exitedOwnLockProof } from '../activation/orcad-exited-own-lock'
import { orcadWindowsBaseDir } from './orcad-remote-windows-node'
import { uploadRemoteInstallDirectory, writeRemoteInstallFile } from './remote-install-transfers'
import {
  abandonInstall,
  finalizeInstall,
  isRemoteInstallComplete
} from './remote-versioned-install'

// Tokens of locks whose removal an ended install of this process could not confirm.
const unreleasedLockTokens = new Set<string>()

/** Also names the lock an ended install of this process left: its owner would have removed it, had the host answered. */
function withOwnUnreleasedLocks(
  proof: InstallLockExitedOwnerProof,
  target: Parameters<typeof readBoundedOrcadRemoteRecord>[0]
): InstallLockExitedOwnerProof {
  return {
    ...proof,
    find: async (lockDir) => {
      const exited = await proof.find(lockDir)
      if (exited !== null || unreleasedLockTokens.size === 0) {
        return exited
      }
      const owner = await readBoundedOrcadRemoteRecord(
        target,
        joinRemotePath(target.host, lockDir, ORCAD_FENCE_OWNER_FILENAME),
        64
      ).catch(() => null)
      const token = owner?.state === 'present' ? owner.raw.trim() : ''
      return unreleasedLockTokens.has(token) ? token : null
    },
    reclaimed: (token) => {
      unreleasedLockTokens.delete(token)
      proof.reclaimed(token)
    }
  }
}

export async function installOrcadBundle(
  options: {
    conn: OrcadHostTransport
    host: RemoteHostPlatform
    localOrcadDir: string
    target: NodeRuntimeTarget
    /** Lazily acquire verified runtime bytes only if the host needs them. */
    nodeRuntimeArchive: () => Promise<string>
    /** Offline archive location named when downloads fail. */
    nodeRuntimeOfflineArchivePath?: string
    /** Per-source connect budget for the host's own download fallback. */
    nodeRuntimeHostConnectTimeoutSeconds?: number
    /** WSL opt-in: reuse a matching stat signature previously hashed to this pin. */
    recordedNodeRuntimeProbe?: boolean
    signal?: AbortSignal
  },
  fullVersion: string,
  remoteDir: string
): Promise<'uploaded' | 'reused'> {
  if (options.recordedNodeRuntimeProbe && (await cachedOrcadSlotInstalled(options, remoteDir))) {
    return 'reused'
  }
  // Existing slot bytes are unusable without their referenced runtime.
  await ensureRemoteOrcadNodeRuntime({
    conn: options.conn,
    host: options.host,
    slotDir: remoteDir,
    target: options.target,
    archivePath: options.nodeRuntimeArchive,
    offlineArchivePath: options.nodeRuntimeOfflineArchivePath,
    hostConnectTimeoutSeconds: options.nodeRuntimeHostConnectTimeoutSeconds,
    signal: options.signal,
    ...(options.recordedNodeRuntimeProbe
      ? { posixProbeCommand: recordedRemoteNodeRuntimeProbeCommand }
      : {})
  })
  if (
    await isRemoteInstallComplete(options.conn, ORCAD_INSTALL_MODEL, remoteDir, options.host, {
      signal: options.signal
    })
  ) {
    return 'reused'
  }
  // Persist the token so a relaunch can prove ownership of an interrupted upload lock.
  const token = randomUUID()
  rememberHeldOrcadFence(token)
  // Optional call: transports outside the SSH stack may not name a target.
  const hostTarget = options.conn.getTarget?.()
  const wait =
    hostTarget && !isWslOrcadHostTarget(hostTarget) ? installLockWait(hostTarget.id) : null
  // SFTP uploads and chmod leave no host workload after this client exits.
  const exitedOwner = exitedOwnLockProof(options, {
    baseDir: orcadWindowsBaseDir(options.host, remoteDir),
    guardsStateMutation: false
  })
  try {
    await acquireInstallLock(options.conn, remoteDir, options.host, {
      signal: options.signal,
      owner: { fileName: ORCAD_FENCE_OWNER_FILENAME, token },
      exitedOwner: wait ? withOwnUnreleasedLocks(exitedOwner, options) : exitedOwner,
      ...(wait ? { waitTimeoutMs: wait.timeoutMs, onHeld: wait.began } : {})
    })
  } catch (error) {
    if (!isUnconfirmedSshCommandTermination(error)) {
      forgetHeldOrcadFence(token)
    } else {
      unreleasedLockTokens.add(token)
    }
    throw error
  } finally {
    wait?.ended()
  }
  let preserveInstallLock = false
  let released = false
  try {
    // A sibling may have completed deployment while this client waited for the lock.
    if (
      await isRemoteInstallComplete(options.conn, ORCAD_INSTALL_MODEL, remoteDir, options.host, {
        signal: options.signal
      })
    ) {
      return 'reused'
    }
    await uploadRemoteInstallDirectory(
      options.conn,
      options.localOrcadDir,
      remoteDir,
      options.host,
      {
        signal: options.signal
      }
    )
    if (options.host.os !== 'win32') {
      await execCommand(
        options.conn,
        executablePermissionsCommand(options.host, remoteDir, options.target),
        {
          wrapCommand: options.host.commandDialect !== 'powershell',
          signal: options.signal
        }
      )
    }
    await writeRemoteInstallFile(
      options.conn,
      options.host,
      joinRemotePath(options.host, remoteDir, ORCAD_INSTALL_MODEL.versionFilename),
      fullVersion,
      { signal: options.signal }
    )
    await finalizeInstall(options.conn, remoteDir, options.host, {
      signal: options.signal,
      releaseLock: false
    })
    return 'uploaded'
  } catch (error) {
    preserveInstallLock = isUnconfirmedSshCommandTermination(error)
    throw error
  } finally {
    try {
      if (!preserveInstallLock) {
        // Retain ownership proof if interrupted cleanup cannot confirm lock removal.
        if (await abandonInstall(options.conn, remoteDir, options.host)) {
          forgetHeldOrcadFence(token)
          released = true
        }
      }
    } finally {
      if (!released) {
        unreleasedLockTokens.add(token)
      }
    }
  }
}

export function executablePermissionsCommand(
  host: RemoteHostPlatform,
  directory: string,
  target: NodeRuntimeTarget
): string {
  const required = [orcadRipgrepArtifact(target), ...orcadNodePtyNativeArtifacts(target)]
    .filter((artifact) => /\/(?:rg|spawn-helper)$/.test(artifact))
    .map((artifact) => joinRemotePath(host, directory, ...artifact.split('/')))
  const browsers = new Set(
    (['glibc', 'musl'] as const).map((libc) =>
      quotePosixShell(
        joinRemotePath(host, directory, orcadAgentBrowserNativeName(host.os, host.arch, libc))
      )
    )
  )
  // Restore executable modes lost by SFTP; absent optional browser binaries remain supported.
  return (
    `chmod 755 ${required.map(quotePosixShell).join(' ')} && ` +
    `for executable in ${[...browsers].join(' ')}; do ` +
    'if [ -f "$executable" ]; then chmod 755 "$executable" || exit $?; fi; done'
  )
}
