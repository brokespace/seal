import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { agentSessionRefusalError } from '../../../shared/agent-session/failures/agent-session-wire-refusals'
import { isFloatingWorkspaceSelector } from '../../../shared/workspace/identity/floating-workspace-worktree'
import {
  isDescendantOrEqual,
  normalizeExistingPath
} from '../../filesystem/local-file-io/filesystem-path-containment'
import { getStructuredAgentSessionHost } from '../../native-chat/agent-session-wire/host/structured-agent-session-registry'
import { agentSessionPinnedLaunchDirectory } from './records/agent-session-record-launch-directory'
import type { StructuredAgentSessionCreateIntentInput } from './structured-agent-session-create-adoption'

async function existingDirectoryRealPath(path: string): Promise<string | null> {
  try {
    const real = await normalizeExistingPath(path)
    return (await stat(real)).isDirectory() ? real : null
  } catch {
    return null
  }
}

/** The requested folder as an absolute host path, once it is proven an existing directory inside the workspace; undefined at the workspace root. */
export async function resolveWorkspaceLaunchDirectory(
  workspacePath: string,
  requested: string
): Promise<string | undefined> {
  const candidate = resolve(workspacePath, requested)
  const [root, folder] = await Promise.all([
    existingDirectoryRealPath(resolve(workspacePath)),
    existingDirectoryRealPath(candidate)
  ])
  // Real paths decide containment, so a link inside the workspace cannot lead out of it.
  if (!root || !folder || !isDescendantOrEqual(folder, root)) {
    console.warn('[agent-session] launch directory is not a folder inside the workspace', candidate)
    // The unsupported code proves nothing was created, so a client may open a terminal there instead.
    throw agentSessionRefusalError('structured_agent_session_unsupported', {
      reason: 'hostUnsupported'
    })
  }
  return folder === root ? undefined : candidate
}

/** Where a new chat's agent starts when that is not its workspace's root: a floating chat's current folder, a fork's source folder, or the requested subfolder. */
export async function resolveStructuredAgentSessionCreateLaunchDirectory(
  input: Pick<
    StructuredAgentSessionCreateIntentInput,
    'envelope' | 'worktree' | 'forkFrom' | 'launchDirectory'
  >,
  resolveWorkspacePath: () => Promise<string>
): Promise<string | undefined> {
  if (isFloatingWorkspaceSelector(input.worktree)) {
    return resolveWorkspacePath()
  }
  const records = getStructuredAgentSessionHost()?.deps.store
  // A copied conversation is saved under its source's folder, so the fork runs there too.
  if (input.forkFrom) {
    const source = records?.getRecord(input.forkFrom.sessionId)
    return source ? agentSessionPinnedLaunchDirectory(source) : undefined
  }
  if (!input.launchDirectory) {
    return undefined
  }
  // A replayed create keeps the folder proven at founding; refusing it now would disown a live chat.
  const founded = records?.getRecord(input.envelope.sessionId)
  return founded
    ? agentSessionPinnedLaunchDirectory(founded)
    : resolveWorkspaceLaunchDirectory(await resolveWorkspacePath(), input.launchDirectory)
}
