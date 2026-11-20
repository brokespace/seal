import { isAgentRpcCaller, resolveRpcCallerIdentity } from '../../callers/rpc-caller-identity'
import { defineMethod, type RpcContext } from '../../core'
import type { OrcadFeature } from '../../startup/orcad-readiness'
import {
  SealConnectorsApplyConfigParams,
  SealConnectorsExportSignInsParams,
  SealConnectorsFleetStatusParams,
  SealConnectorsImportSignInsParams,
  SealConnectorsRefreshNowParams,
  SealConnectorsRemoveSignInParams,
  SealConnectorsSetConfigParams,
  SealConnectorsSetLeaseParams,
  SealConnectorsSetRefresherParams,
  SealConnectorsSetStaticSecretParams,
  SealConnectorsSignInVersionsParams,
  SealConnectorsStatusParams
} from '../../../../../shared/rpc-contract/seal-connectors-params'
import { getSealConnectorsFleet } from '../../../../seal-connectors/seal-connectors-fleet'
import { requireSealConnectorsService } from '../../../../seal-connectors/seal-connectors-install'
import { setStaticSignIn } from '../../../../seal-connectors/seal-connectors-sign-in-records'

// Sign-in secrets move between a user's desktop and hosts, never to a phone or an agent's CLI.
function requireDesktopCaller(context: RpcContext): void {
  if (context.clientKind === 'mobile' || isAgentRpcCaller(resolveRpcCallerIdentity(context))) {
    throw new Error('Only a Seal desktop can move connector sign-ins on this host.')
  }
}

const connectors = () => requireSealConnectorsService()

const SEAL_CONNECTOR_METHOD_DEFINITIONS = [
  defineMethod({
    name: 'seal.connectors.status',
    permission: 'workspace',
    params: SealConnectorsStatusParams,
    handler: async () => connectors().status()
  }),
  defineMethod({
    name: 'seal.connectors.setConfig',
    permission: 'accounts-admin',
    params: SealConnectorsSetConfigParams,
    handler: async (params) => {
      connectors().applyLocalEdit(params.base, params.config)
      return connectors().status()
    }
  }),
  defineMethod({
    name: 'seal.connectors.applyConfig',
    permission: 'accounts-admin',
    params: SealConnectorsApplyConfigParams,
    handler: async (params) => connectors().applyConfig(params.config)
  }),
  defineMethod({
    name: 'seal.connectors.signInVersions',
    permission: 'accounts-admin',
    params: SealConnectorsSignInVersionsParams,
    handler: async () => connectors().signInVersions()
  }),
  defineMethod({
    name: 'seal.connectors.exportSignIns',
    permission: 'accounts-admin',
    params: SealConnectorsExportSignInsParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return connectors().exportSignIns(params.ids)
    }
  }),
  defineMethod({
    name: 'seal.connectors.importSignIns',
    permission: 'accounts-admin',
    params: SealConnectorsImportSignInsParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return { imported: connectors().importSignIns(params.signIns) }
    }
  }),
  defineMethod({
    name: 'seal.connectors.setLease',
    permission: 'accounts-admin',
    params: SealConnectorsSetLeaseParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return { accepted: connectors().setLease(params.lease) }
    }
  }),
  defineMethod({
    name: 'seal.connectors.setRefresher',
    permission: 'accounts-admin',
    params: SealConnectorsSetRefresherParams,
    handler: async (params) => {
      connectors().setDesignatedRefresher(params.hostKey)
      return connectors().status()
    }
  }),
  defineMethod({
    name: 'seal.connectors.refreshNow',
    permission: 'accounts-admin',
    params: SealConnectorsRefreshNowParams,
    handler: async () => {
      const refresher = connectors().refresher
      return refresher
        ? refresher.refreshNow()
        : { refreshed: [], skipped: 'The refresher is not running on this host.' }
    }
  }),
  defineMethod({
    name: 'seal.connectors.setStaticSecret',
    permission: 'accounts-admin',
    params: SealConnectorsSetStaticSecretParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      const signInId = setStaticSignIn(connectors(), params)
      return { signInId, status: connectors().status() }
    }
  }),
  defineMethod({
    name: 'seal.connectors.removeSignIn',
    permission: 'accounts-admin',
    params: SealConnectorsRemoveSignInParams,
    handler: async (params) => {
      connectors().removeSignInFrom(params.connectorId, params.signInId)
      return connectors().status()
    }
  }),
  defineMethod({
    name: 'seal.connectors.fleetStatus',
    permission: 'workspace',
    params: SealConnectorsFleetStatusParams,
    handler: async () => {
      const fleet = getSealConnectorsFleet()
      if (!fleet) {
        throw new Error('Every machine’s connectors are shown from the Seal desktop app.')
      }
      return fleet.fleetStatus()
    }
  })
]

export const SEAL_CONNECTOR_METHODS = SEAL_CONNECTOR_METHOD_DEFINITIONS.map((method) => ({
  ...method,
  requires: ['accounts'] satisfies OrcadFeature[]
}))
