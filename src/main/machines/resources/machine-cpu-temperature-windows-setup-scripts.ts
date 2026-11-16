import { createHash } from 'node:crypto'
import { encodePowerShellCommand } from '../../../shared/powershell-command-encoding'
import { SEAL_LIBRE_HARDWARE_MONITOR_PORT } from './machine-cpu-temperature-windows'

/**
 * Windows hands a processor's temperature only to a kernel driver, so reading it takes a monitor
 * that runs with administrator rights. LibreHardwareMonitor from 0.9.5 on reads through the signed
 * PawnIO driver; both are fetched from their own GitHub releases and held to these checksums.
 */
export const LIBRE_HARDWARE_MONITOR = {
  version: '0.9.6',
  url: 'https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip',
  sha256: '086D9F1B5A99E643EDC2CFAAAC16051685B551E4C5AC0B32A57C58C0E529C001'
} as const
export const PAWNIO = {
  version: '2.2.0',
  url: 'https://github.com/namazso/PawnIO.Setup/releases/download/2.2.0/PawnIO_setup.exe',
  sha256: '1F519A22E47187F70A1379A48CA604981C4FCF694F4E65B734AAA74A9FBA3032'
} as const

export const SETUP_MARKER = 'SEAL_CPU_TEMP_SETUP '
export const OUTCOME_MARKER = 'SEAL_CPU_TEMP_RUN '
const WEB_URL = `http://127.0.0.1:${SEAL_LIBRE_HARDWARE_MONITOR_PORT}/data.json`

// Program Files is writable by administrators only, which a program started elevated at every sign-in needs.
const LOCATIONS = [
  "$root = Join-Path $env:ProgramFiles 'Seal CPU Temperature'",
  "$app = Join-Path $root 'LibreHardwareMonitor'",
  "$exe = Join-Path $app 'LibreHardwareMonitor.exe'",
  "$task = 'Seal CPU temperature'"
]

const STATUS_LINES = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  ...LOCATIONS,
  'function Test-SealMonitor {',
  '  if (-not (Get-Process -Name LibreHardwareMonitor)) { return $false }',
  `  try { return [bool](Invoke-RestMethod -Uri '${WEB_URL}' -TimeoutSec 2 -UseBasicParsing) } catch { return $false }`,
  '}',
  '$wait = $false',
  // A started monitor needs a few seconds before its web server answers.
  'for ($i = 0; $wait -and $i -lt 30 -and -not (Test-SealMonitor); $i++) {',
  '  if ($i -ge 8 -and -not (Get-Process -Name LibreHardwareMonitor)) { break }',
  '  Start-Sleep -Seconds 1',
  '}',
  "$groups = (& whoami.exe /groups /fo csv /nh) -join ' '",
  '$result = $null',
  "try { $result = Get-Content -LiteralPath (Join-Path $root 'setup.json') -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json } catch { $result = $null }",
  '& schtasks.exe /query /tn $task 2>$null | Out-Null',
  '$registered = $LASTEXITCODE -eq 0',
  '$status = [ordered]@{',
  '  installed = (Test-Path -LiteralPath $exe)',
  '  task = $registered',
  '  process = [bool](Get-Process -Name LibreHardwareMonitor)',
  '  answering = (Test-SealMonitor)',
  '  ok = $result.ok',
  '  message = [string]$result.message',
  // Administrators is listed, as deny-only, for an administrator who has not elevated.
  "  admin = ($groups -match 'S-1-5-32-544')",
  "  elevated = ($groups -match 'S-1-16-(12288|16384)')",
  '  session = (Get-Process -Id $PID).SessionId',
  '  account = [string](& whoami.exe)',
  '}',
  `Write-Output ('${SETUP_MARKER}' + ($status | ConvertTo-Json -Compress))`
]

export const STATUS_SCRIPT = STATUS_LINES.join('\n')
/** The status once a monitor that was just started has had time to answer. */
export const SETTLED_STATUS_SCRIPT = STATUS_SCRIPT.replace('$wait = $false', '$wait = $true')

const REPORT_OUTCOME = `Write-Output ('${OUTCOME_MARKER}' + ([ordered]@{ outcome = $outcome; detail = [string]$detail; exit = $exit } | ConvertTo-Json -Compress))`

// The task belongs to the signed-in account, which may start it without elevating again.
export const START_SCRIPT = [
  "$ErrorActionPreference = 'SilentlyContinue'",
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  "$outcome = 'done'",
  "$detail = ''",
  '$exit = 0',
  "& schtasks.exe /run /tn 'Seal CPU temperature' 2>$null | Out-Null",
  'if ($LASTEXITCODE -ne 0) {',
  "  $outcome = 'failed'",
  '  $detail = "Windows did not start the scheduled task (schtasks ended with code $LASTEXITCODE)."',
  '}',
  REPORT_OUTCOME
].join('\n')

const ELEVATED_PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  ...LOCATIONS,
  "$step = 'preparing'",
  'function Save-SealSetupResult($ok, $message) {',
  `  $text = [ordered]@{ ok = $ok; message = [string]$message; version = '${LIBRE_HARDWARE_MONITOR.version}' } | ConvertTo-Json -Compress`,
  "  Set-Content -LiteralPath (Join-Path $root 'setup.json') -Value $text -Encoding UTF8",
  '}',
  'function Stop-SealMonitor {',
  '  Stop-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue',
  '  Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force -PassThru | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue',
  '}'
]

const MONITOR_SETTINGS = {
  startMinMenuItem: true,
  minTrayMenuItem: true,
  // Closing its window leaves the monitor running in the tray.
  minCloseMenuItem: true,
  runWebServerMenuItem: true,
  listenerPort: SEAL_LIBRE_HARDWARE_MONITOR_PORT,
  cpuMenuItem: true,
  // Only the processor is read, so the web server has no fan or pump control to offer.
  mainboardMenuItem: false,
  ramMenuItem: false,
  gpuMenuItem: false,
  powerMonitorMenuItem: false,
  fanControllerMenuItem: false,
  hddMenuItem: false,
  nicMenuItem: false,
  psuMenuItem: false,
  batteryMenuItem: false
}

const MONITOR_CONFIG = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<configuration>',
  '  <appSettings>',
  ...Object.entries(MONITOR_SETTINGS).map(
    ([key, value]) => `    <add key="${key}" value="${String(value)}" />`
  ),
  '  </appSettings>',
  '</configuration>'
]

const FIREWALL_RULE = 'Seal CPU temperature (local only)'

export const INSTALL_SCRIPT = [
  ...ELEVATED_PRELUDE,
  'function Get-SealSetupDownload($url, $hash, $name) {',
  '  $file = Join-Path $root $name',
  '  Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing',
  '  if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $hash) {',
  '    Remove-Item -LiteralPath $file -Force',
  '    throw "$name does not match the checksum Seal expects, so it was not used."',
  '  }',
  '  $file',
  '}',
  'try {',
  '  New-Item -ItemType Directory -Force -Path $root | Out-Null',
  '  $who = & whoami.exe /user /fo csv /nh | ConvertFrom-Csv -Header Name, Sid',
  "  if ($who.Sid -eq 'S-1-5-18') { throw 'Setup has to run as the Windows account that signs in to this PC, not as the system account.' }",
  '  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12',
  "  $note = ''",
  "  $step = 'installing the PawnIO driver'",
  '  $have = $null',
  // LibreHardwareMonitor stops at a dialog on start unless it finds PawnIO 2 here.
  "  try { $have = [version](Get-ItemProperty -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\PawnIO').DisplayVersion } catch { $have = $null }",
  "  if (-not $have -or $have -lt [version]'2.0.0') {",
  `    $setup = Get-SealSetupDownload '${PAWNIO.url}' '${PAWNIO.sha256}' 'PawnIO_setup.exe'`,
  "    $run = Start-Process -FilePath $setup -ArgumentList '-install', '-silent' -Wait -PassThru",
  '    Remove-Item -LiteralPath $setup -Force',
  "    if ($run.ExitCode -eq 3010) { $note = 'Restart Windows to finish installing the PawnIO driver.' }",
  '    elseif ($run.ExitCode -ne 0) { throw "The PawnIO installer ended with code $($run.ExitCode)." }',
  '  }',
  "  $step = 'installing LibreHardwareMonitor'",
  `  $zip = Get-SealSetupDownload '${LIBRE_HARDWARE_MONITOR.url}' '${LIBRE_HARDWARE_MONITOR.sha256}' 'LibreHardwareMonitor.zip'`,
  '  Stop-SealMonitor',
  '  if (Test-Path -LiteralPath $app) { Remove-Item -LiteralPath $app -Recurse -Force }',
  '  Expand-Archive -LiteralPath $zip -DestinationPath $app',
  '  Remove-Item -LiteralPath $zip -Force',
  "  Set-Content -LiteralPath (Join-Path $app 'LibreHardwareMonitor.config') -Encoding UTF8 -Value @(",
  ...MONITOR_CONFIG.map(
    (line, index) => `    '${line}'${index < MONITOR_CONFIG.length - 1 ? ',' : ''}`
  ),
  '  )',
  // The web server listens on every address; this keeps other computers out whatever else the firewall allows.
  '  try {',
  `    Remove-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue`,
  `    New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Action Block -Protocol TCP -LocalPort ${SEAL_LIBRE_HARDWARE_MONITOR_PORT} | Out-Null`,
  '  } catch { }',
  "  $step = 'adding the scheduled task'",
  '  $action = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $app',
  '  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $who.Name',
  '  $principal = New-ScheduledTaskPrincipal -UserId $who.Name -LogonType Interactive -RunLevel Highest',
  // Without a zero limit Windows ends the monitor after three days.
  '  $options = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)',
  "  Register-ScheduledTask -TaskName $task -Action $action -Trigger $trigger -Principal $principal -Settings $options -Description 'Starts LibreHardwareMonitor so Seal can show the CPU temperature.' -Force | Out-Null",
  '  Start-ScheduledTask -TaskName $task',
  '  Save-SealSetupResult $true $note',
  '} catch {',
  '  try { Save-SealSetupResult $false "Setup stopped while $step`: $($_.Exception.Message)" } catch { }',
  '  exit 1',
  '}'
].join('\n')

// PawnIO stays: other hardware tools share it, and Windows lists it under installed apps.
export const REMOVE_SCRIPT = [
  ...ELEVATED_PRELUDE,
  'try {',
  "  $step = 'removing the monitor'",
  '  Stop-SealMonitor',
  '  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue',
  `  try { Remove-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue } catch { }`,
  '  if (Test-Path -LiteralPath $root) { Remove-Item -LiteralPath $root -Recurse -Force }',
  '} catch {',
  '  try { Save-SealSetupResult $false "Removal stopped while $step`: $($_.Exception.Message)" } catch { }',
  '  exit 1',
  '}'
].join('\n')

const HANDOVER_FILE = "Join-Path $env:LOCALAPPDATA 'Seal\\cpu-temperature-setup.ps1'"
const CHANGED_SCRIPT_EXIT_CODE = 87

/**
 * What the elevated PowerShell is started with. The script itself is too long for a command line,
 * so it waits in a file the account can write; this runs it only if it is still, byte for byte,
 * the script Seal sent.
 */
function elevatedCommand(script: string): string {
  const sha256 = createHash('sha256').update(script, 'utf8').digest('hex').toUpperCase()
  return encodePowerShellCommand(
    [
      `$bytes = [IO.File]::ReadAllBytes((${HANDOVER_FILE}))`,
      "$hash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)) -replace '-', ''",
      `if ($hash -ne '${sha256}') { exit ${CHANGED_SCRIPT_EXIT_CODE} }`,
      'Invoke-Expression ([Text.Encoding]::UTF8.GetString($bytes))'
    ].join('\n')
  )
}

/**
 * Hands the script on stdin to an elevated PowerShell and waits for it. Windows asks for approval
 * once unless the connection is elevated already; refusing leaves the machine untouched.
 */
function launchScript(script: string): string {
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    "$outcome = 'done'",
    "$detail = ''",
    `$handover = ${HANDOVER_FILE}`,
    'New-Item -ItemType Directory -Force -Path (Split-Path -Parent $handover) | Out-Null',
    '$file = [IO.File]::Open($handover, [IO.FileMode]::Create)',
    '[Console]::OpenStandardInput().CopyTo($file)',
    '$file.Close()',
    '$start = @{',
    "  FilePath = 'powershell.exe'",
    `  ArgumentList = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${elevatedCommand(script)}'`,
    "  WindowStyle = 'Hidden'",
    '  Wait = $true',
    '  PassThru = $true',
    "  ErrorAction = 'Stop'",
    '}',
    "if (-not ((& whoami.exe /groups /fo csv /nh) -join ' ' -match 'S-1-16-(12288|16384)')) { $start.Verb = 'RunAs' }",
    '$run = $null',
    'try { $run = Start-Process @start } catch {',
    '  $code = $_.Exception.NativeErrorCode',
    '  if (-not $code) { $code = $_.Exception.InnerException.NativeErrorCode }',
    // 1223 is what Windows reports when its approval prompt is answered with No.
    "  if ($code -eq 1223) { $outcome = 'declined' } else { $outcome = 'failed'; $detail = $_.Exception.Message }",
    '}',
    '$exit = $null',
    'try { $exit = $run.ExitCode } catch { $exit = $null }',
    `if ($exit -eq ${CHANGED_SCRIPT_EXIT_CODE}) {`,
    "  $outcome = 'failed'",
    "  $detail = 'The setup script was changed before it ran, so it was not run.'",
    '}',
    'Remove-Item -LiteralPath $handover -Force',
    REPORT_OUTCOME
  ].join('\n')
}

export const INSTALL_LAUNCH_SCRIPT = launchScript(INSTALL_SCRIPT)
export const REMOVE_LAUNCH_SCRIPT = launchScript(REMOVE_SCRIPT)
