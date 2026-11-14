import { UtilityModelSetCloudflareParams } from '../../../../../shared/rpc-contract/utility-model-params'
import { getUtilityModelHost } from '../../../../utility-model/utility-model-host'
import { defineMethod, type RpcContext } from '../../core'

// A phone may see whether a provider is set up, never set or replace its credentials.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can change model provider credentials on this host.')
  }
}

/** The host's utility model (session summaries). Replies carry presence and health, never the token. */
export const UTILITY_MODEL_METHODS = [
  defineMethod({
    name: 'utilityModel.status',
    permission: 'workspace',
    params: null,
    handler: async () => getUtilityModelHost().status()
  }),
  defineMethod({
    name: 'utilityModel.setCloudflare',
    permission: 'accounts-admin',
    params: UtilityModelSetCloudflareParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return getUtilityModelHost().setCloudflare(params)
    }
  }),
  defineMethod({
    name: 'utilityModel.clearCloudflare',
    permission: 'accounts-admin',
    params: null,
    handler: async (_, context) => {
      requireDesktopCaller(context)
      return getUtilityModelHost().clearCloudflare()
    }
  }),
  defineMethod({
    name: 'utilityModel.listModels',
    permission: 'workspace',
    params: null,
    handler: async () => getUtilityModelHost().service.listModels()
  }),
  defineMethod({
    name: 'utilityModel.test',
    permission: 'accounts-admin',
    params: null,
    handler: async () => {
      const host = getUtilityModelHost()
      return { result: await host.service.test(), status: await host.status() }
    }
  })
] as const
