import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'
import { posixPathWord } from '../machines/home-chat-machine-paths'
import { powerShellLiteral } from '../machines/home-chat-machine-scripts'
import type { HomeChatShellDialect } from '../machines/home-chat-machine-types'

// Each job lives in ~/.seal/jobs/<id> on its machine: cmd, out.log (stdout+stderr), pid, exit.
const MARKER = '__SEAL_JOB__'
const PRUNE_DAYS = 7

export type JobLaunch = {
  jobId: string
  command: string
  cwd?: string
  /** Seconds to wait for the job to finish before reporting it as running; 0 returns at once. */
  waitSeconds: number
  tailBytes: number
  /** Delete the job folder when it finishes inside the wait and its whole log fit in the reply. */
  removeWhenFinished: boolean
}

export type JobReport =
  | { state: 'exited'; exitCode: number | null; totalBytes: number; output: string }
  | { state: 'running'; pid: number | null; totalBytes: number; output: string }
  | { state: 'lost'; totalBytes: number; output: string }
  | { state: 'missing' }

const safeId = (jobId: string): string => jobId.replace(/[^a-zA-Z0-9-]/g, '')

function posixPrelude(jobId: string): string {
  return `d="$HOME/.seal/jobs/${safeId(jobId)}"`
}

function posixReport(tailBytes: number): string {
  return [
    'size=0; [ -f "$d/out.log" ] && size=$(wc -c < "$d/out.log" | tr -d " ")',
    `if [ -f "$d/exit" ]; then printf '${MARKER} exited %s %s\\n' "$(cat "$d/exit")" "$size"`,
    `elif kill -0 "$(cat "$d/pid" 2>/dev/null)" 2>/dev/null; then printf '${MARKER} running %s %s\\n' "$(cat "$d/pid")" "$size"`,
    `elif [ -d "$d" ]; then printf '${MARKER} lost - %s\\n' "$size"`,
    `else printf '${MARKER} missing\\n'; exit 0; fi`,
    `tail -c ${tailBytes} "$d/out.log" 2>/dev/null`
  ].join('\n')
}

function powerShellPrelude(jobId: string): string {
  return `$d = Join-Path $env:USERPROFILE '.seal\\jobs\\${safeId(jobId)}'`
}

function powerShellReport(tailBytes: number): string {
  return [
    '$log = Join-Path $d "out.log"',
    '$size = if (Test-Path -LiteralPath $log) { (Get-Item -LiteralPath $log).Length } else { 0 }',
    '$jobPid = Get-Content -LiteralPath (Join-Path $d "pid") -ErrorAction SilentlyContinue',
    `if (Test-Path -LiteralPath (Join-Path $d "exit")) { "${MARKER} exited $((Get-Content -LiteralPath (Join-Path $d 'exit')).Trim()) $size" }`,
    `elseif ($jobPid -and (Get-Process -Id $jobPid -ErrorAction SilentlyContinue)) { "${MARKER} running $jobPid $size" }`,
    `elseif (Test-Path -LiteralPath $d) { "${MARKER} lost - $size" }`,
    `else { "${MARKER} missing"; exit 0 }`,
    'if ($size -gt 0) {',
    "  $f = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')",
    `  $start = [Math]::Max(0, $f.Length - ${tailBytes}); $f.Seek($start, 'Begin') | Out-Null`,
    '  $buf = New-Object byte[] ($f.Length - $start); $f.Read($buf, 0, $buf.Length) | Out-Null; $f.Close()',
    '  [Console]::Out.Write([Text.Encoding]::UTF8.GetString($buf))',
    '}'
  ].join('\n')
}

// Runs the command under bash (or sh) with the environment of the user's login shell profile.
const POSIX_RUNNER = [
  'd=$1',
  'SEAL_JOB_CMD="$d/cmd"; export SEAL_JOB_CMD',
  'if command -v bash >/dev/null 2>&1; then SEAL_JOB_SH=bash; else SEAL_JOB_SH=/bin/sh; fi',
  'export SEAL_JOB_SH',
  'login=',
  // Only shells known to accept `-l -c`; all of them read this one line the same way.
  'case "${SHELL##*/}" in sh|dash|bash|zsh|fish|ksh|mksh) [ -x "$SHELL" ] && login=1 ;; esac',
  'if [ -n "$login" ]; then',
  '  "$SHELL" -l -c \'exec "$SEAL_JOB_SH" "$SEAL_JOB_CMD"\' > "$d/out.log" 2>&1 < /dev/null',
  'elif [ "$SEAL_JOB_SH" = bash ]; then',
  '  bash -l "$d/cmd" > "$d/out.log" 2>&1 < /dev/null',
  'else',
  '  /bin/sh "$d/cmd" > "$d/out.log" 2>&1 < /dev/null',
  'fi',
  'echo $? > "$d/exit.tmp"; mv "$d/exit.tmp" "$d/exit"'
].join('\n')

/** A quoted here-document copies text verbatim, so nothing has to be decoded on the machine. */
function posixWriteFile(target: string, content: string, jobId: string): string {
  let delimiter = `SEAL_EOF_${safeId(jobId)}`
  while (content.includes(delimiter)) {
    delimiter += 'X'
  }
  return `cat > ${target} <<'${delimiter}' || exit 1\n${content}\n${delimiter}`
}

function posixLaunch(job: JobLaunch): string {
  return [
    posixPrelude(job.jobId),
    // The detached job inherits this directory.
    job.cwd ? `cd ${posixPathWord(job.cwd)} || exit 1` : '',
    'mkdir -p "$d" || exit 1',
    `find "$HOME/.seal/jobs" -mindepth 1 -maxdepth 1 -type d -mtime +${PRUNE_DAYS} -exec rm -rf {} + 2>/dev/null`,
    posixWriteFile('"$d/cmd"', job.command, job.jobId),
    posixWriteFile('"$d/run"', POSIX_RUNNER, job.jobId),
    // A new session survives the SSH channel closing and lets job_kill signal the whole tree.
    'if command -v setsid >/dev/null 2>&1; then',
    '  setsid /bin/sh "$d/run" "$d" > /dev/null 2>&1 < /dev/null &',
    'elif command -v perl >/dev/null 2>&1; then',
    '  perl -MPOSIX=setsid -e \'setsid(); exec @ARGV\' /bin/sh "$d/run" "$d" > /dev/null 2>&1 < /dev/null &',
    'else',
    '  nohup /bin/sh "$d/run" "$d" > /dev/null 2>&1 < /dev/null &',
    'fi',
    'echo $! > "$d/pid"',
    'if sleep 0.2 2>/dev/null; then step=0.2; per=5; else step=1; per=1; fi',
    `i=0; n=$((${Math.max(0, Math.floor(job.waitSeconds))} * per))`,
    'while [ ! -f "$d/exit" ] && [ "$i" -lt "$n" ]; do sleep "$step"; i=$((i + 1)); done',
    posixReport(job.tailBytes),
    job.removeWhenFinished
      ? `[ -f "$d/exit" ] && [ "$size" -le ${job.tailBytes} ] && rm -rf "$d"`
      : '',
    'exit 0'
  ].join('\n')
}

function powerShellLaunch(job: JobLaunch): string {
  const encoded = Buffer.from(job.command, 'utf8').toString('base64')
  const cd = job.cwd ? `Set-Location -LiteralPath ${powerShellLiteral(job.cwd)}\n` : ''
  const runner = [
    powerShellPrelude(job.jobId),
    cd,
    '$log = Join-Path $d "out.log"',
    'try {',
    '  Invoke-Expression ([IO.File]::ReadAllText((Join-Path $d "cmd"))) *>&1 | Out-File -LiteralPath $log -Encoding utf8 -Append',
    '  $code = if ($LASTEXITCODE) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 }',
    '} catch { $_ | Out-File -LiteralPath $log -Encoding utf8 -Append; $code = 1 }',
    'Set-Content -LiteralPath (Join-Path $d "exit") -Value $code'
  ].join('\n')
  return [
    powerShellPrelude(job.jobId),
    'New-Item -ItemType Directory -Force -Path $d | Out-Null',
    `Get-ChildItem -Directory (Split-Path $d) | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-${PRUNE_DAYS}) } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue`,
    `[IO.File]::WriteAllBytes((Join-Path $d "cmd"), [Convert]::FromBase64String('${encoded}'))`,
    // Win32_Process.Create escapes the SSH session's job object, so the job outlives the connection.
    `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ${encodePowerShellCommand(runner)}' }`,
    'Set-Content -LiteralPath (Join-Path $d "pid") -Value $r.ProcessId',
    `$deadline = (Get-Date).AddSeconds(${Math.max(0, Math.floor(job.waitSeconds))})`,
    'while (-not (Test-Path -LiteralPath (Join-Path $d "exit")) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }',
    powerShellReport(job.tailBytes),
    job.removeWhenFinished
      ? `if ((Test-Path -LiteralPath (Join-Path $d "exit")) -and $size -le ${job.tailBytes}) { Remove-Item -LiteralPath $d -Recurse -Force }`
      : ''
  ].join('\n')
}

export function jobLaunchScript(dialect: HomeChatShellDialect, job: JobLaunch): string {
  return dialect === 'powershell' ? powerShellLaunch(job) : posixLaunch(job)
}

export function jobStatusScript(
  dialect: HomeChatShellDialect,
  jobId: string,
  tailBytes: number
): string {
  return dialect === 'powershell'
    ? `${powerShellPrelude(jobId)}\n${powerShellReport(tailBytes)}`
    : `${posixPrelude(jobId)}\n${posixReport(tailBytes)}`
}

/** Read `length` bytes of the log starting at byte `offset`. */
export function jobOutputRangeScript(
  dialect: HomeChatShellDialect,
  jobId: string,
  offset: number,
  length: number
): string {
  if (dialect === 'powershell') {
    return [
      powerShellPrelude(jobId),
      "$f = [IO.File]::Open((Join-Path $d 'out.log'), 'Open', 'Read', 'ReadWrite')",
      `$f.Seek(${offset}, 'Begin') | Out-Null; $buf = New-Object byte[] ${length}`,
      '$n = $f.Read($buf, 0, $buf.Length); $f.Close()',
      '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($buf, 0, $n))'
    ].join('\n')
  }
  return `${posixPrelude(jobId)}\ntail -c +${offset + 1} "$d/out.log" | head -c ${length}`
}

export function jobKillScript(dialect: HomeChatShellDialect, jobId: string): string {
  if (dialect === 'powershell') {
    return [
      powerShellPrelude(jobId),
      '$jobPid = Get-Content -LiteralPath (Join-Path $d "pid") -ErrorAction SilentlyContinue',
      'if ($jobPid) { taskkill /PID $jobPid /T /F | Out-Null }',
      'if (-not (Test-Path -LiteralPath (Join-Path $d "exit"))) { Set-Content -LiteralPath (Join-Path $d "exit") -Value 143 }'
    ].join('\n')
  }
  return [
    posixPrelude(jobId),
    'p=$(cat "$d/pid" 2>/dev/null) || exit 0',
    // dash's kill rejects `--`, so signal the group as a bare negative pid.
    'kill -TERM "-$p" 2>/dev/null || { pkill -TERM -P "$p" 2>/dev/null; kill -TERM "$p" 2>/dev/null; }',
    'i=0; while kill -0 "$p" 2>/dev/null && [ "$i" -lt 30 ]; do sleep 0.1 2>/dev/null || sleep 1; i=$((i + 1)); done',
    'kill -KILL "-$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null',
    '[ -f "$d/exit" ] || echo 143 > "$d/exit"',
    'exit 0'
  ].join('\n')
}

/** Block until the job ends (or its process vanishes), then report it. */
export function jobWatchScript(
  dialect: HomeChatShellDialect,
  jobId: string,
  tailBytes: number
): string {
  if (dialect === 'powershell') {
    return [
      powerShellPrelude(jobId),
      '$jobPid = Get-Content -LiteralPath (Join-Path $d "pid") -ErrorAction SilentlyContinue',
      'while (-not (Test-Path -LiteralPath (Join-Path $d "exit")) -and $jobPid -and (Get-Process -Id $jobPid -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 2 }',
      'Start-Sleep -Seconds 1',
      powerShellReport(tailBytes)
    ].join('\n')
  }
  return [
    posixPrelude(jobId),
    'p=$(cat "$d/pid" 2>/dev/null)',
    'while [ ! -f "$d/exit" ] && kill -0 "$p" 2>/dev/null; do sleep 2; done',
    // The wrapper writes exit just after the command returns.
    '[ -f "$d/exit" ] || sleep 1',
    posixReport(tailBytes)
  ].join('\n')
}

export function jobRemoveScript(dialect: HomeChatShellDialect, jobId: string): string {
  return dialect === 'powershell'
    ? `${powerShellPrelude(jobId)}\nRemove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue`
    : `${posixPrelude(jobId)}\nrm -rf "$d"`
}

export function parseJobReport(stdout: string): JobReport {
  const index = stdout.lastIndexOf(`${MARKER} `)
  if (index === -1) {
    throw new Error(`Unexpected job script output: ${stdout.slice(0, 400)}`)
  }
  const lineEnd = stdout.indexOf('\n', index)
  const header = stdout
    .slice(index, lineEnd === -1 ? undefined : lineEnd)
    .trim()
    .split(/\s+/)
  const output = lineEnd === -1 ? '' : stdout.slice(lineEnd + 1)
  const [, state, value, size] = header
  const totalBytes = Number.parseInt(size ?? '0', 10) || 0
  if (state === 'exited') {
    const code = Number.parseInt(value ?? '', 10)
    return { state, exitCode: Number.isFinite(code) ? code : null, totalBytes, output }
  }
  if (state === 'running') {
    const pid = Number.parseInt(value ?? '', 10)
    return { state, pid: Number.isFinite(pid) ? pid : null, totalBytes, output }
  }
  if (state === 'lost') {
    return { state, totalBytes, output }
  }
  return { state: 'missing' }
}
