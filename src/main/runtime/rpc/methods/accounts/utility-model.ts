import {
  UtilityModelProviderParams,
  UtilityModelSetCloudflareParams,
  UtilityModelSetOpenRouterParams,
  UtilityModelTestParams
} from '../../../../../shared/rpc-contract/utility-model-params'
import { getUtilityModelHost } from '../../../../utility-model/utility-model-host'
import { defineMethod, type RpcContext } from '../../core'

// A phone may see whether a provider is set up, never set or replace its credentials.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can change model provider credentials on this host.')
  }
}

const DEFAULT_PROVIDER = 'cloudflare-workers-ai'

/** The host's utility models (session summaries and recaps). Replies carry presence and health, never a key. */
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
    name: 'utilityModel.providers',
    permission: 'workspace',
    params: null,
    handler: async () => getUtilityModelHost().providers()
  }),
  defineMethod({
    name: 'utilityModel.setOpenRouter',
    permission: 'accounts-admin',
    params: UtilityModelSetOpenRouterParams,
    handler: async ({ apiKey }, context) => {
      requireDesktopCaller(context)
      return getUtilityModelHost().setOpenRouter(apiKey)
    }
  }),
  defineMethod({
    name: 'utilityModel.clearOpenRouter',
    permission: 'accounts-admin',
    params: null,
    handler: async (_, context) => {
      requireDesktopCaller(context)
      return getUtilityModelHost().clearOpenRouter()
    }
  }),
  defineMethod({
    name: 'utilityModel.listModels',
    permission: 'workspace',
    params: UtilityModelProviderParams,
    handler: async ({ provider }) =>
      getUtilityModelHost()
        .provider(provider ?? DEFAULT_PROVIDER)
        .listModels()
  }),
  defineMethod({
    name: 'utilityModel.test',
    permission: 'accounts-admin',
    params: UtilityModelTestParams,
    handler: async ({ provider = DEFAULT_PROVIDER, model = null, fallbackModel = null }) => {
      const host = getUtilityModelHost()
      const result = await host.provider(provider).test({ choice: { model, fallbackModel } })
      return {
        result,
        status: await host.status(),
        providerStatus: await host.providerStatus(provider)
      }
    }
  })
] as const
