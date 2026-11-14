/** Path math for machine browsing; local Windows paths use `\`, everything else `/`. */
export type MachinePathStyle = 'posix' | 'windows'

export function machinePathStyle(path: string): MachinePathStyle {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') ? 'windows' : 'posix'
}

function separatorFor(style: MachinePathStyle): string {
  return style === 'windows' ? '\\' : '/'
}

function trimTrailingSeparators(path: string, style: MachinePathStyle): string {
  const pattern = style === 'windows' ? /[\\/]+$/ : /\/+$/
  const trimmed = path.replace(pattern, '')
  if (style === 'windows' && /^[A-Za-z]:$/.test(trimmed)) {
    return `${trimmed}\\`
  }
  return trimmed === '' ? separatorFor(style) : trimmed
}

export function joinMachinePath(dir: string, name: string): string {
  const style = machinePathStyle(dir)
  const sep = separatorFor(style)
  const base = trimTrailingSeparators(dir, style)
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`
}

export function machinePathBasename(path: string): string {
  const style = machinePathStyle(path)
  const trimmed = trimTrailingSeparators(path, style)
  const parts = trimmed.split(style === 'windows' ? /[\\/]/ : '/')
  return parts.at(-1) || trimmed
}

/** Null at a filesystem root. */
export function machinePathDirname(path: string): string | null {
  const style = machinePathStyle(path)
  const trimmed = trimTrailingSeparators(path, style)
  const sep = separatorFor(style)
  if (trimmed === sep || (style === 'windows' && /^[A-Za-z]:\\$/.test(trimmed))) {
    return null
  }
  const index = Math.max(
    trimmed.lastIndexOf('/'),
    style === 'windows' ? trimmed.lastIndexOf('\\') : -1
  )
  if (index < 0) {
    return null
  }
  if (index === 0) {
    return sep
  }
  const parent = trimmed.slice(0, index)
  return style === 'windows' && /^[A-Za-z]:$/.test(parent) ? `${parent}\\` : parent
}

export type MachinePathCrumb = { label: string; path: string }

export function machinePathCrumbs(path: string): MachinePathCrumb[] {
  const crumbs: MachinePathCrumb[] = []
  let current: string | null = trimTrailingSeparators(path, machinePathStyle(path))
  while (current) {
    const parent = machinePathDirname(current)
    crumbs.unshift({
      label: parent === null ? current : machinePathBasename(current),
      path: current
    })
    current = parent
  }
  return crumbs
}

/** Rejects names that would escape their folder or that no filesystem accepts. */
export function isValidMachineFileName(name: string): boolean {
  const trimmed = name.trim()
  return (
    trimmed.length > 0 &&
    trimmed !== '.' &&
    trimmed !== '..' &&
    !/[\\/\0]/.test(trimmed) &&
    trimmed.length <= 255
  )
}
