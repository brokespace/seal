import { machinePathStyle } from '../../../../../shared/machines/machine-paths'

function separatorOf(path: string): string {
  return machinePathStyle(path) === 'windows' ? '\\' : '/'
}

function typedParts(typed: string): { dir: string; name: string } {
  const cut = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\')) + 1
  return { dir: typed.slice(0, cut), name: typed.slice(cut) }
}

/**
 * Suggestions to show while the answer for the latest keystroke is on its way: the previous
 * answer still applies when only the last name grew, narrowed to what is typed now.
 */
export function folderMatchesFor<Match extends { name: string }>(
  typed: string,
  answered: { for: string; matches: readonly Match[] } | null
): readonly Match[] {
  if (!answered || answered.for === typed) {
    return answered?.matches ?? []
  }
  const now = typedParts(typed)
  if (typedParts(answered.for).dir !== now.dir) {
    return []
  }
  const name = now.name.toLowerCase()
  return answered.matches.filter((match) => match.name.toLowerCase().startsWith(name))
}

/** What the input shows for a folder: `~` stays `~` when that is how the path was being typed. */
function typedFormOf(typed: string, path: string, homeDir: string | null): string {
  if (
    typed.trimStart().startsWith('~') &&
    homeDir &&
    (path === homeDir || path.startsWith(`${homeDir}/`))
  ) {
    return `~${path.slice(homeDir.length)}`
  }
  return path
}

/** The input after Tab picks `path`: that folder with a trailing separator, ready for the next name. */
export function completedFolderInput(typed: string, path: string, homeDir: string | null): string {
  const shown = typedFormOf(typed, path, homeDir)
  const separator = separatorOf(path)
  return shown.endsWith(separator) ? shown : `${shown}${separator}`
}

/**
 * The input after Tab with several candidates: what they all share, as a shell would complete it.
 * Null when that adds nothing to what is typed.
 */
export function sharedFolderInput(
  typed: string,
  parent: string,
  names: readonly string[],
  homeDir: string | null
): string | null {
  const [first = '', ...rest] = names
  let shared = first
  for (const name of rest) {
    let length = 0
    while (length < shared.length && shared[length] === name[length]) {
      length += 1
    }
    shared = shared.slice(0, length)
  }
  const separator = separatorOf(parent)
  if (shared.length <= typedParts(typed).name.length) {
    return null
  }
  const base = typedFormOf(typed, parent, homeDir)
  return `${base.endsWith(separator) ? base : `${base}${separator}`}${shared}`
}
