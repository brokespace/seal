import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileAtomically } from '../filesystem/atomic-file-publication'
import {
  CLAUDE_INJECTED_CONFIG_DIR_ENV,
  CLAUDE_PROFILE_POINTER_ENV,
  CLAUDE_USER_CONFIG_DIR_ENV
} from '../../shared/claude-profile-routing'
import type { ClaudeProfileRouter } from '../claude-accounts/profiles/routing/claude-profile-router'
import type { ClaudeRuntimeAuthPreparation } from '../claude-accounts/runtime-auth/runtime-auth-types'

const REFRESH_WAIT_MS = 5_000

export type SealClaudePin = {
  env: Record<string, string>
  preparation: ClaudeRuntimeAuthPreparation
}

type PinRouter = Pick<
  ClaudeProfileRouter,
  'accountHome' | 'accountLogin' | 'coveredBySystemDefault' | 'prepareAccount' | 'systemDefaultHome'
>

/** Each pinned account gets its own pointer, so the pane's `claude` keeps that account after a host swap. */
export function sealPinnedPointerPath(dataRoot: string, pin: string): string {
  return join(dataRoot, 'claude-profiles', 'seal-pinned', pin)
}

async function writePointer(path: string, home: string): Promise<void> {
  if ((await readFile(path, 'utf8').catch(() => null)) === home) {
    return
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  writeFileAtomically(path, home, { mode: 0o600 })
}

function withoutInjectedConfigDir(env: Record<string, string>): Record<string, string> {
  const next = { ...env }
  if (next.CLAUDE_CONFIG_DIR && next.CLAUDE_CONFIG_DIR === next[CLAUDE_INJECTED_CONFIG_DIR_ENV]) {
    delete next.CLAUDE_CONFIG_DIR
  }
  delete next[CLAUDE_INJECTED_CONFIG_DIR_ENV]
  const userConfigDir = next[CLAUDE_USER_CONFIG_DIR_ENV]
  if (userConfigDir) {
    next.CLAUDE_CONFIG_DIR = userConfigDir
  }
  return next
}

/** Route one launch to a saved account (or System default when null), whatever the host selects. */
export async function pinClaudeLaunch(args: {
  router: PinRouter
  dataRoot: string
  accountId: string | null
  env: Record<string, string>
}): Promise<SealClaudePin> {
  const { router, dataRoot, accountId } = args
  if (accountId === null || router.coveredBySystemDefault(accountId)) {
    const pointer = sealPinnedPointerPath(dataRoot, 'system')
    // An empty pointer makes the shell function restore the user's own Claude config.
    await writePointer(pointer, '')
    const env = { ...withoutInjectedConfigDir(args.env), [CLAUDE_PROFILE_POINTER_ENV]: pointer }
    return {
      env,
      preparation: {
        configDir: router.systemDefaultHome(),
        runtime: 'host',
        wslDistro: null,
        wslLinuxConfigDir: null,
        envPatch: { [CLAUDE_PROFILE_POINTER_ENV]: pointer },
        provenance: 'seal:system'
      }
    }
  }
  const home = router.accountHome(accountId)
  if (router.accountLogin(accountId)) {
    // Prepared homes refresh in the background; never hold a launch longer than Orca does.
    const refresh = router.prepareAccount(accountId).catch((error: unknown) => {
      console.warn('[seal-accounts] Claude account refresh failed:', error)
    })
    await Promise.race([
      refresh,
      new Promise((resolve) => setTimeout(resolve, REFRESH_WAIT_MS).unref())
    ])
  } else {
    await router.prepareAccount(accountId)
    if (!router.accountLogin(accountId)) {
      throw new Error('This Claude account is not signed in on this machine.')
    }
  }
  return pinClaudeLaunchToHome({ dataRoot, pin: accountId, home, env: args.env })
}

/** Route one launch to a prepared Claude config dir through its own pointer file. */
export async function pinClaudeLaunchToHome(args: {
  dataRoot: string
  pin: string
  home: string
  env: Record<string, string>
}): Promise<SealClaudePin> {
  const pointer = sealPinnedPointerPath(args.dataRoot, args.pin)
  await writePointer(pointer, args.home)
  const envPatch = {
    [CLAUDE_PROFILE_POINTER_ENV]: pointer,
    CLAUDE_CONFIG_DIR: args.home,
    [CLAUDE_INJECTED_CONFIG_DIR_ENV]: args.home
  }
  return {
    env: { ...args.env, ...envPatch },
    preparation: {
      configDir: args.home,
      runtime: 'host',
      wslDistro: null,
      wslLinuxConfigDir: null,
      envPatch,
      provenance: `seal:${args.pin}`
    }
  }
}
