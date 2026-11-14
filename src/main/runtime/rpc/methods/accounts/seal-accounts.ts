import { defineMethod, type RpcContext } from '../../core'
import { resolveRpcCallerIdentity } from '../../callers/rpc-caller-identity'
import type { OrcadFeature } from '../../startup/orcad-readiness'
import {
  SealAccountsAddApiKeyParams,
  SealAccountsApplyFleetConfigParams,
  SealAccountsChooseNextLaunchParams,
  SealAccountsImportCredentialParams,
  SealAccountsPickParams,
  SealAccountsPinWorkspaceParams,
  SealAccountsRemoveApiKeyParams,
  SealAccountsSetAutoSwapParams,
  SealAccountsSetConfigParams,
  SealAccountsSetPolicyParams,
  SealAccountsSetProfileParams,
  SealAccountsStatusParams,
  SealAccountsSwapParams,
  SealAccountsSyncFleetParams,
  SealAccountsSwapSessionParams,
  SealAccountsSetSessionLiveSwapParams,
  SealAccountsCredentialFreshnessParams,
  SealAccountsExportCredentialParams
} from '../../../../../shared/rpc-contract/seal-accounts-params'
import { requireSealAccountManager } from '../../../../seal-accounts/seal-account-manager'
import { addSealApiKey, removeSealApiKey } from '../../../../seal-accounts/seal-api-key-accounts'
import {
  importedCredentialKey,
  importSealCredential
} from '../../../../seal-accounts/seal-credential-transfer'
import { exportSealCredential, syncSealFleet } from '../../../../seal-accounts/seal-fleet-sync'
import { localLoginFreshness } from '../../../../seal-accounts/seal-fleet-credentials'
import { recordFleetCopies, SEAL_DESKTOP_COPY } from '../../../../seal-accounts/seal-fleet-copies'
import {
  setSealSessionLiveSwap,
  swapSealSessionTo
} from '../../../../seal-accounts/seal-session-swap'
import { pickSealLaunch } from '../../../../seal-accounts/seal-launch-pick-context'
import { sealNextLaunchAccounts } from '../../../../seal-accounts/seal-next-launch-account'
import { refreshSealSystemLogins } from '../../../../seal-accounts/seal-system-login'
import { SEAL_ACCOUNT_ROSTER_METHODS } from './seal-account-roster'
import {
  withAutoSwap,
  withPolicyEdit,
  withProfile
} from '../../../../../shared/seal-accounts/seal-accounts-config-edits'

// Phones can view and switch, but logins only move between machines the user's own desktop owns.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can change account credentials on this host.')
  }
}

const accounts = () => requireSealAccountManager()

const SEAL_ACCOUNT_METHOD_DEFINITIONS = [
  defineMethod({
    name: 'seal.accounts.status',
    permission: 'workspace',
    params: SealAccountsStatusParams,
    handler: async (params) => {
      if (params?.refreshUsage) {
        await accounts().refreshUsage()
      }
      await refreshSealSystemLogins()
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.setConfig',
    permission: 'accounts-admin',
    params: SealAccountsSetConfigParams,
    handler: async (params) => {
      accounts().saveConfig(params.config)
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.applyFleetConfig',
    permission: 'accounts-admin',
    params: SealAccountsApplyFleetConfigParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      accounts().applyFleetConfig(params.config, params.machineKey)
      return {}
    }
  }),
  defineMethod({
    name: 'seal.accounts.setProfile',
    permission: 'accounts-admin',
    params: SealAccountsSetProfileParams,
    handler: async (params) => {
      const manager = accounts()
      const key = manager.resolveKey(params.account)
      manager.saveConfig(withProfile(manager.getConfig(), key, params.profile))
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.setAutoSwap',
    permission: 'accounts-admin',
    params: SealAccountsSetAutoSwapParams,
    handler: async (params) => {
      const manager = accounts()
      manager.saveConfig(withAutoSwap(manager.getConfig(), params.provider, params.settings))
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.setPolicy',
    permission: 'accounts-admin',
    params: SealAccountsSetPolicyParams,
    handler: async (params) => {
      const manager = accounts()
      const resolve = (ref: string) => manager.resolveKey(ref, params.provider)
      manager.saveConfig(
        withPolicyEdit(manager.getConfig(), {
          ...params,
          allow: params.allow?.map(resolve),
          default:
            params.default === undefined || params.default === null
              ? params.default
              : resolve(params.default)
        })
      )
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.swap',
    permission: 'accounts-admin',
    params: SealAccountsSwapParams,
    handler: async (params) => {
      const event = params.account
        ? await accounts().swapTo(params.provider, params.account)
        : await accounts().evaluate(params.provider, { force: true })
      return { event, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.pick',
    permission: 'workspace',
    params: SealAccountsPickParams,
    handler: async (params) =>
      pickSealLaunch(accounts(), {
        provider: params.provider,
        worktreeId: params.worktreeId,
        override: params.account ? { ref: params.account, source: 'env' } : null,
        autoRank: true
      })
  }),
  defineMethod({
    name: 'seal.accounts.pinWorkspace',
    permission: 'accounts-admin',
    params: SealAccountsPinWorkspaceParams,
    handler: async (params) => {
      accounts().pinWorkspace(params.worktreeId, params.provider, params.account)
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.chooseNextLaunch',
    permission: 'accounts-admin',
    params: SealAccountsChooseNextLaunchParams,
    handler: async (params) => {
      const manager = accounts()
      sealNextLaunchAccounts(manager).set(
        params.repoId,
        params.provider,
        params.account === null ? null : manager.resolveKey(params.account, params.provider)
      )
      return {}
    }
  }),
  defineMethod({
    name: 'seal.accounts.addApiKey',
    permission: 'accounts-admin',
    params: SealAccountsAddApiKeyParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      const key = addSealApiKey(accounts(), params.provider, params.label, params.apiKey)
      return { key, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.removeApiKey',
    permission: 'accounts-admin',
    params: SealAccountsRemoveApiKeyParams,
    handler: async (params) => {
      removeSealApiKey(accounts(), params.id)
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.importCredential',
    permission: 'accounts-admin',
    params: SealAccountsImportCredentialParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      await importSealCredential(accounts(), params)
      const key = importedCredentialKey(params)
      if (key) {
        recordFleetCopies(accounts(), SEAL_DESKTOP_COPY, [key])
      }
      return {}
    }
  }),
  defineMethod({
    name: 'seal.accounts.syncFleet',
    permission: 'accounts-admin',
    params: SealAccountsSyncFleetParams,
    handler: async (params, context) => {
      // Exported logins must never leave this desktop for a paired client's request.
      const caller = resolveRpcCallerIdentity(context)?.kind
      if (caller !== 'desktop' && caller !== 'local-cli') {
        throw new Error('Push accounts from the Seal desktop app or its CLI.')
      }
      const targets = [...(params.environmentIds ?? []), ...(params.machineIds ?? [])]
      return { results: await syncSealFleet(accounts(), targets, params.accounts) }
    }
  }),
  defineMethod({
    name: 'seal.accounts.swapSession',
    permission: 'accounts-admin',
    params: SealAccountsSwapSessionParams,
    handler: async (params) => {
      const entry = await swapSealSessionTo(accounts(), params.sessionId, params.account)
      return { entry, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.setSessionLiveSwap',
    permission: 'accounts-admin',
    params: SealAccountsSetSessionLiveSwapParams,
    handler: async (params) => {
      setSealSessionLiveSwap(accounts(), params.sessionId, params.mode)
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.credentialFreshness',
    permission: 'accounts-admin',
    params: SealAccountsCredentialFreshnessParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return { accounts: await localLoginFreshness(accounts(), params.accounts) }
    }
  }),
  defineMethod({
    name: 'seal.accounts.exportCredential',
    permission: 'accounts-admin',
    params: SealAccountsExportCredentialParams,
    handler: async (params, context) => {
      // The managing desktop pulls back a login this host refreshed; phones never see one.
      requireDesktopCaller(context)
      return exportSealCredential(accounts(), params.account)
    }
  })
]

export const SEAL_ACCOUNT_METHODS = [
  ...SEAL_ACCOUNT_METHOD_DEFINITIONS,
  ...SEAL_ACCOUNT_ROSTER_METHODS
].map((method) => ({
  ...method,
  requires: ['accounts'] satisfies OrcadFeature[]
}))
