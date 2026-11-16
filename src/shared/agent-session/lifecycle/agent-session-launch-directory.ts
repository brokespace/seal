import { MAX_PATH_LENGTH } from './accounts/agent-session-account-home'

/** A stored record's launch directory: a bounded host path, and the mark only a founding in a workspace subfolder writes. */
export function isOptionalAgentSessionLaunchDirectory(record: {
  launchDirectory?: unknown
  launchDirectoryInWorkspace?: unknown
}): boolean {
  const { launchDirectory, launchDirectoryInWorkspace } = record
  return (
    (launchDirectory === undefined ||
      (typeof launchDirectory === 'string' &&
        launchDirectory.length > 0 &&
        launchDirectory.length <= MAX_PATH_LENGTH)) &&
    (launchDirectoryInWorkspace === undefined || launchDirectoryInWorkspace === true)
  )
}
