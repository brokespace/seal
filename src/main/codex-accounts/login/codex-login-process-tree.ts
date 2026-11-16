import { execFileSync } from 'node:child_process'
import type { WindowsHostInteractiveLoginSpawn } from '../../providers/shell-launch/windows/windows-interactive-login-spawn'
import { admitSelfInitiatedTreeKill } from '../../pty/process-retirement/own-chromium-tree-kill-guard'
import { reapAccountCliProcess } from '../../provider-process/account-cli-process-reaper'
import type { CodexLoginChild } from './codex-login-session'

const WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS = 5_000

export function killLoginProcessTree(
  child: CodexLoginChild,
  interactiveLogin?: WindowsHostInteractiveLoginSpawn | null
): void {
  const terminationPid = interactiveLogin?.getTerminationPid?.() ?? child.pid
  if (
    process.platform === 'win32' &&
    typeof terminationPid === 'number' &&
    child.exitCode === null &&
    child.signalCode === null &&
    // Record only attempted kills; Electron-owned PIDs fall back to a direct signal.
    admitSelfInitiatedTreeKill({
      pid: terminationPid,
      site: 'codex-account-login-teardown',
      scope: 'win-taskkill-tree'
    })
  ) {
    try {
      // Kill descendants too: their Windows file handles can block post-login home operations.
      execFileSync('taskkill', ['/pid', String(terminationPid), '/t', '/f'], {
        windowsHide: true,
        timeout: WINDOWS_LOGIN_TREE_KILL_TIMEOUT_MS,
        stdio: 'ignore'
      })
      return
    } catch {
      // If the tree already exited, still try signaling the direct child.
    }
  }
  if (process.platform === 'win32') {
    child.kill()
    return
  }
  // SIGTERM lets codex close its login server; SIGKILL follows if anything is still running.
  reapAccountCliProcess(child, { group: true })
}
