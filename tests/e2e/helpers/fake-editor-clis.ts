import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type FakeEditorClis = {
  /** Prepend to PATH so the app launches these instead of a real editor. */
  binDir: string
  /** Every launch so far, oldest first: the launcher's name followed by its arguments. */
  launches: () => string[][]
  dispose: () => void
}

/**
 * Stand-in editor launchers that record how they were started and exit. `exitCodes` names the
 * launchers that fail, and with what status.
 */
export function createFakeEditorClis(
  names: readonly string[],
  exitCodes: Readonly<Record<string, number>> = {}
): FakeEditorClis {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-editors-'))
  const log = path.join(dir, 'launches.log')
  for (const name of names) {
    const file = path.join(dir, name)
    // One line per launch; arguments are joined with a unit separator no path contains.
    writeFileSync(
      file,
      `#!/bin/sh\n{ printf '%s' "${name}"; for arg in "$@"; do printf '\\037%s' "$arg"; done; printf '\\n'; } >> "${log}"\nexit ${exitCodes[name] ?? 0}\n`
    )
    chmodSync(file, 0o755)
  }
  return {
    binDir: dir,
    launches: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => line.split('\u001f'))
        : [],
    dispose: () => rmSync(dir, { recursive: true, force: true })
  }
}
