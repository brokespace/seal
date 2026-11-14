import { defineMethod, type RpcContext } from '../../core'
import { rpcCallerOperationKey } from '../../callers/rpc-caller-identity'
import {
  SealAccountsAddSetupTokenParams,
  SealAccountsDismissNoticeParams,
  SealAccountsImportSystemLoginParams,
  SealAccountsRemoveAccountParams,
  SealAccountsReorderParams,
  SealAccountsSignInCancelParams,
  SealAccountsSignInStartParams,
  SealAccountsSignInSubmitCodeParams,
  SealAccountsSignInWaitParams
} from '../../../../../shared/rpc-contract/seal-accounts-params'
import { requireSealAccountManager } from '../../../../seal-accounts/seal-account-manager'
import { refreshSealSystemLogins } from '../../../../seal-accounts/seal-system-login'
import { removeSealAccount } from '../../../../seal-accounts/seal-account-removal'
import { addSealApiKey } from '../../../../seal-accounts/seal-api-key-accounts'
import {
  dismissSealMigrationNotice,
  restoreSealSystemLogin
} from '../../../../seal-accounts/seal-system-login-listing'

const accounts = () => requireSealAccountManager()

// Phones can view and switch, but adding, removing and signing in belong to the user's desktop.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can change account credentials on this host.')
  }
}

/** The caller a sign-in belongs to; only it may read the sign-in page, answer or cancel. */
function signInOwner({ caller }: Pick<RpcContext, 'caller'>): string {
  if (!caller) {
    throw new Error('This client cannot add accounts on this host.')
  }
  return rpcCallerOperationKey(caller)
}

/** Adding, removing, ordering and signing in to the accounts this host holds. */
export const SEAL_ACCOUNT_ROSTER_METHODS = [
  defineMethod({
    name: 'seal.accounts.addSetupToken',
    permission: 'accounts-admin',
    params: SealAccountsAddSetupTokenParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      const key = addSealApiKey(accounts(), 'claude', params.label, params.token, 'setup-token')
      return { key, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.removeAccount',
    permission: 'accounts-admin',
    params: SealAccountsRemoveAccountParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      const result = await removeSealAccount(accounts(), params.account, {
        logout: params.logout,
        provider: params.provider
      })
      return { result, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.importSystemLogin',
    permission: 'accounts-admin',
    params: SealAccountsImportSystemLoginParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      await refreshSealSystemLogins()
      const login = restoreSealSystemLogin(accounts(), params.provider)
      return { login, status: accounts().status() }
    }
  }),
  defineMethod({
    name: 'seal.accounts.reorder',
    permission: 'accounts-admin',
    params: SealAccountsReorderParams,
    handler: async (params) => {
      accounts().reorder(params.provider, params.accounts)
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.dismissNotice',
    permission: 'accounts-admin',
    params: SealAccountsDismissNoticeParams,
    handler: async () => {
      dismissSealMigrationNotice(accounts())
      return accounts().status()
    }
  }),
  defineMethod({
    name: 'seal.accounts.signInStart',
    permission: 'accounts-admin',
    params: SealAccountsSignInStartParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      const flows = accounts().signIns
      const owner = signInOwner(context)
      // One sign-in per client: starting another ends the last one and its CLI process.
      const running = flows.activeFlowId(owner)
      if (running) {
        await flows.cancel(owner, running)
      }
      return flows.start(owner, params.provider, params)
    }
  }),
  defineMethod({
    name: 'seal.accounts.signInWait',
    permission: 'accounts-admin',
    params: SealAccountsSignInWaitParams,
    handler: async ({ flowId, afterRevision }, context) =>
      accounts().signIns.wait(signInOwner(context), flowId, afterRevision, context.signal)
  }),
  defineMethod({
    name: 'seal.accounts.signInSubmitCode',
    permission: 'accounts-admin',
    params: SealAccountsSignInSubmitCodeParams,
    handler: async ({ flowId, code }, context) =>
      accounts().signIns.submitCode(signInOwner(context), flowId, code)
  }),
  defineMethod({
    name: 'seal.accounts.signInCancel',
    permission: 'accounts-admin',
    params: SealAccountsSignInCancelParams,
    handler: async ({ flowId }, context) => accounts().signIns.cancel(signInOwner(context), flowId)
  })
]
