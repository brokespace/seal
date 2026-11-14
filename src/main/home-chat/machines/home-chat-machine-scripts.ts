import { quotePosixShell } from '../../../shared/shell/launch/shell-argument-quoting'
import { posixPathWord } from './home-chat-machine-paths'
import type { HomeChatMachineLoad, HomeChatShellDialect } from './home-chat-machine-types'

export function powerShellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function quoteForDialect(dialect: HomeChatShellDialect, value: string): string {
  return dialect === 'powershell' ? powerShellLiteral(value) : quotePosixShell(value)
}

export function scriptWithCwd(
  dialect: HomeChatShellDialect,
  script: string,
  cwd: string | undefined
): string {
  if (!cwd) {
    return script
  }
  return dialect === 'powershell'
    ? `Set-Location -LiteralPath ${powerShellLiteral(cwd)}\n${script}`
    : `cd ${posixPathWord(cwd)} || exit 1\n${script}`
}

export function posixLoadProbeScript(): string {
  return [
    'getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo x',
    "cut -d' ' -f1 /proc/loadavg 2>/dev/null || sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk '{print $1}'"
  ].join('\n')
}

export function powerShellLoadProbeScript(): string {
  return [
    '$cpu = (Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors',
    '$pct = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average',
    'Write-Output $cpu',
    'Write-Output ([math]::Round($cpu * $pct / 100, 2))'
  ].join('\n')
}

export function parseLoadProbe(stdout: string): HomeChatMachineLoad {
  const [cpu, load] = stdout.trim().split(/\s+/)
  const cpuCount = Number.parseInt(cpu ?? '', 10)
  const loadAverage = Number.parseFloat(load ?? '')
  return {
    cpuCount: Number.isFinite(cpuCount) ? cpuCount : null,
    loadAverage1m: Number.isFinite(loadAverage) ? loadAverage : null
  }
}

export function readFileBase64Script(
  dialect: HomeChatShellDialect,
  path: string,
  maxBytes: number
): string {
  // One extra byte tells a file of exactly maxBytes apart from a longer one; base64 keeps bytes intact.
  if (dialect === 'powershell') {
    return [
      `$f = [IO.File]::OpenRead(${powerShellLiteral(path)})`,
      `$buf = New-Object byte[] ${maxBytes + 1}`,
      '$n = $f.Read($buf, 0, $buf.Length); $f.Close()',
      '[Console]::Out.Write([Convert]::ToBase64String($buf, 0, $n))'
    ].join('\n')
  }
  const quoted = quotePosixShell(path)
  // The pipeline's status is base64's, so check readability first.
  return `if [ ! -f ${quoted} ] || [ ! -r ${quoted} ]; then printf 'cannot read %s: not a readable file\\n' ${quoted} >&2; exit 1; fi; head -c ${maxBytes + 1} -- ${quoted} | base64 | tr -d '\\n'`
}

export function decodeBase64File(
  stdout: string,
  maxBytes: number
): { text: string; truncated: boolean } {
  const bytes = Buffer.from(stdout.trim(), 'base64')
  return { text: bytes.subarray(0, maxBytes).toString('utf8'), truncated: bytes.length > maxBytes }
}

/** Write the script's stdin to a file, creating parent directories. */
export function writeFromStdinScript(
  dialect: HomeChatShellDialect,
  path: string,
  append: boolean
): string {
  if (dialect === 'powershell') {
    const mode = append ? 'Append' : 'Create'
    return [
      `$p = ${powerShellLiteral(path)}`,
      '$d = Split-Path -Parent $p',
      'if ($d) { New-Item -ItemType Directory -Force -Path $d | Out-Null }',
      `$f = [IO.File]::Open($p, [IO.FileMode]::${mode})`,
      '[Console]::OpenStandardInput().CopyTo($f); $f.Close()'
    ].join('\n')
  }
  const quoted = quotePosixShell(path)
  return `mkdir -p -- "$(dirname -- ${quoted})" && cat ${append ? '>>' : '>'} ${quoted}`
}
