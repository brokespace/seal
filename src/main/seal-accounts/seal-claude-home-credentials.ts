import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeSecureFile } from '../../shared/secure-storage/secure-file'
import { updateClaudeGlobalConfig } from '../claude/configuration/claude-folder-trust-file'
import {
  claudeConfigDirKeychainAliases,
  claudeKeychainService,
  getKeychainUser,
  readActiveClaudeKeychainCredentialsStrict
} from '../claude-accounts/runtime-auth/keychain'
import { claudeStateFileAsync } from '../claude-accounts/sign-in/claude-account-folder'
import { execSecurityCommand, isKeychainNotFoundError } from '../macos-keychain/generic-password'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The login stored for one Claude config dir: macOS keychain first, as Claude Code reads it. */
export async function readClaudeHomeCredentials(
  configDir: string,
  options: { system?: boolean } = {}
): Promise<string | null> {
  if (process.platform === 'darwin') {
    const fromKeychain = await readActiveClaudeKeychainCredentialsStrict(
      options.system ? undefined : configDir
    ).catch(() => null)
    if (fromKeychain) {
      return fromKeychain
    }
  }
  return readFile(join(configDir, '.credentials.json'), 'utf8').catch(() => null)
}

export async function readClaudeOAuthAccount(
  configDir: string | undefined
): Promise<Record<string, unknown> | null> {
  try {
    const state: unknown = JSON.parse(await readFile(await claudeStateFileAsync(configDir), 'utf8'))
    return isRecord(state) && isRecord(state.oauthAccount) ? state.oauthAccount : null
  } catch {
    return null
  }
}

/**
 * Removes a config dir's hashed Keychain item (every spelling Claude may hash) so it cannot
 * shadow the file Seal writes. Authoring that item would couple Seal to Claude's private format.
 */
async function retireMacKeychainItems(configDir: string): Promise<void> {
  for (const dir of claudeConfigDirKeychainAliases(configDir)) {
    await execSecurityCommand([
      'delete-generic-password',
      '-s',
      claudeKeychainService(dir),
      '-a',
      getKeychainUser()
    ]).catch((error: unknown) => {
      if (!isKeychainNotFoundError(error)) {
        throw new Error('Could not clear the old Claude login from this Mac’s keychain.')
      }
    })
  }
}

/**
 * Writes a login into a custom Claude config dir the way claude-swap seeds one: plaintext
 * `.credentials.json`, which Claude moves into its own Keychain item on its next write. Call it
 * while holding that dir's refresh locks. The new file mtime makes a running Claude drop its
 * memoized token and adopt this one.
 */
export async function writeClaudeHomeCredentials(
  configDir: string,
  credentialsJson: string
): Promise<void> {
  JSON.parse(credentialsJson)
  if (process.platform === 'darwin') {
    await retireMacKeychainItems(configDir)
  }
  writeSecureFile(join(configDir, '.credentials.json'), credentialsJson)
}

/** Points a config dir's account identity (the `/status` email and org) at another login. */
export async function writeClaudeOAuthAccount(
  configDir: string,
  oauthAccount: Record<string, unknown>
): Promise<void> {
  const stateFile = await claudeStateFileAsync(configDir)
  const outcome = await updateClaudeGlobalConfig(stateFile, (config) =>
    JSON.stringify(config.oauthAccount) === JSON.stringify(oauthAccount)
      ? { kind: 'unchanged' }
      : { kind: 'changed', config: { ...config, oauthAccount } }
  )
  if (outcome === 'missing-config') {
    writeSecureFile(stateFile, JSON.stringify({ oauthAccount }, null, 2))
    return
  }
  if (outcome !== 'updated' && outcome !== 'unchanged') {
    throw new Error(`Could not update the Claude account identity (${outcome}).`)
  }
}
