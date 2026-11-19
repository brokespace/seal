import { machinePathDirname } from '../../shared/machines/machine-paths'
import { quotePosixShell } from '../../shared/shell/launch/shell-argument-quoting'
import type { MachineConnection } from '../machines/connection/machine-connection'

const EXEC_TIMEOUT_MS = 30_000
/** Exit code the scripts use for "something that is not Seal's link is already there". */
const OCCUPIED = 3

function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export type SkillLinkResult = 'linked' | 'occupied'

/**
 * Links a plugin's skill folder into an agent's skills folder, so updates to the plugin reach it.
 * Windows gets a junction, which needs no administrator rights. A link already pointing at the
 * skill counts as made.
 */
export async function linkSkillFolder(
  connection: MachineConnection,
  target: string,
  link: string
): Promise<SkillLinkResult> {
  const parent = machinePathDirname(link)
  if (parent) {
    await connection.files.createDir(parent)
  }
  const script =
    (await connection.dialect()) === 'powershell'
      ? [
          `$link = ${powerShellLiteral(link)}; $target = ${powerShellLiteral(target)}`,
          `$item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue`,
          `if ($item) { if ($item.LinkType -and ($item.Target -contains $target)) { exit 0 } else { exit ${OCCUPIED} } }`,
          `New-Item -ItemType Junction -Path $link -Target $target | Out-Null; exit $LASTEXITCODE`
        ].join('\n')
      : [
          `link=${quotePosixShell(link)}; target=${quotePosixShell(target)}`,
          `if [ -L "$link" ] && [ "$(readlink -- "$link")" = "$target" ]; then exit 0; fi`,
          `if [ -e "$link" ] || [ -L "$link" ]; then exit ${OCCUPIED}; fi`,
          `ln -s -- "$target" "$link"`
        ].join('\n')
  const result = await connection.exec(script, { timeoutMs: EXEC_TIMEOUT_MS })
  if (result.exitCode === OCCUPIED) {
    return 'occupied'
  }
  if (result.exitCode !== 0) {
    throw new Error(`Could not link ${link}: ${result.stderr.trim() || result.stdout.trim()}`)
  }
  return 'linked'
}

/** Removes the link only, never what it points at; a real folder there is left alone. */
export async function unlinkSkillFolder(
  connection: MachineConnection,
  link: string
): Promise<void> {
  const script =
    (await connection.dialect()) === 'powershell'
      ? [
          `$item = Get-Item -LiteralPath ${powerShellLiteral(link)} -Force -ErrorAction SilentlyContinue`,
          `if ($item -and $item.LinkType) { $item.Delete() }`
        ].join('\n')
      : `if [ -L ${quotePosixShell(link)} ]; then rm -f -- ${quotePosixShell(link)}; fi`
  const result = await connection.exec(script, { timeoutMs: EXEC_TIMEOUT_MS })
  if (result.exitCode !== 0) {
    throw new Error(`Could not remove the link ${link}: ${result.stderr.trim()}`)
  }
}
