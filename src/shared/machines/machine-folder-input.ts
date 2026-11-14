import { machinePathStyle } from './machine-paths'

export type MachineFolderInput = {
  /** Absolute folder whose children complete the last segment. */
  parent: string
  /** What is typed of the last segment; empty right after a separator. */
  prefix: string
}

function collapsePosix(path: string): string {
  const kept: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      kept.pop()
    } else {
      kept.push(segment)
    }
  }
  return `/${kept.join('/')}`
}

/**
 * Turns what is typed into "Go to folder" into an absolute path: `~` is the home folder and a
 * relative path continues from the folder currently shown. Null when nothing absolute results.
 */
export function expandMachineFolderInput(
  input: string,
  context: { homeDir: string | null; currentDir: string | null }
): string | null {
  const typed = input.trimStart()
  if (typed === '') {
    return null
  }
  let path = typed
  if (typed === '~' || typed.startsWith('~/')) {
    if (!context.homeDir) {
      return null
    }
    path = `${context.homeDir}${typed.slice(1)}`
  } else if (machinePathStyle(typed) === 'windows') {
    return typed
  } else if (!typed.startsWith('/')) {
    if (!context.currentDir) {
      return null
    }
    path = `${context.currentDir}/${typed}`
  }
  if (machinePathStyle(path) === 'windows') {
    return path.replaceAll('/', '\\')
  }
  const collapsed = collapsePosix(path)
  // The trailing separator says "inside this folder", which completion depends on.
  return path.endsWith('/') && collapsed !== '/' ? `${collapsed}/` : collapsed
}

/** Splits an expanded path into the folder to list and the partial name to match in it. */
export function splitMachineFolderInput(expanded: string): MachineFolderInput {
  const windows = machinePathStyle(expanded) === 'windows'
  const index = Math.max(expanded.lastIndexOf('/'), windows ? expanded.lastIndexOf('\\') : -1)
  if (index < 0) {
    return { parent: expanded, prefix: '' }
  }
  const parent = expanded.slice(0, index)
  const root = windows ? /^[A-Za-z]:$/.test(parent) : parent === ''
  return {
    parent: root ? expanded.slice(0, index + 1) : parent,
    prefix: expanded.slice(index + 1)
  }
}
