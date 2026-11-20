import { defineMethod, type RpcContext } from '../../core'
import type { OrcadFeature } from '../../startup/orcad-readiness'
import { getAppEnvironment } from '../../../../../shared/app-environment'
import {
  SealConnectorsAttemptParams,
  SealConnectorsStartSignInParams,
  SealConnectorsSubmitRedirectParams
} from '../../../../../shared/rpc-contract/seal-connectors-params'
import {
  cancelSealConnectorSignIn,
  startSealConnectorSignIn,
  submitSealConnectorRedirect,
  waitForSealConnectorSignIn
} from '../../../../seal-connectors/seal-connectors-sign-in'

// Sign-ins land in this host's store, so a phone never drives them.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can sign in to connectors.')
  }
}

const SIGN_IN_METHOD_DEFINITIONS = [
  defineMethod({
    name: 'seal.connectors.startSignIn',
    permission: 'accounts-admin',
    params: SealConnectorsStartSignInParams,
    handler: (params, context) => {
      requireDesktopCaller(context)
      return startSealConnectorSignIn(params, { userData: getAppEnvironment().getPath('userData') })
    }
  }),
  defineMethod({
    name: 'seal.connectors.submitRedirect',
    permission: 'accounts-admin',
    params: SealConnectorsSubmitRedirectParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return { message: await submitSealConnectorRedirect(params.attemptId, params.url) }
    }
  }),
  defineMethod({
    name: 'seal.connectors.waitSignIn',
    permission: 'accounts-admin',
    params: SealConnectorsAttemptParams,
    handler: (params, context) => {
      requireDesktopCaller(context)
      return waitForSealConnectorSignIn(params.attemptId)
    }
  }),
  defineMethod({
    name: 'seal.connectors.cancelSignIn',
    permission: 'accounts-admin',
    params: SealConnectorsAttemptParams,
    handler: (params, context) => {
      requireDesktopCaller(context)
      cancelSealConnectorSignIn(params.attemptId)
      return {}
    }
  })
]

export const SEAL_CONNECTOR_SIGN_IN_METHODS = SIGN_IN_METHOD_DEFINITIONS.map((method) => ({
  ...method,
  requires: ['accounts'] satisfies OrcadFeature[]
}))
