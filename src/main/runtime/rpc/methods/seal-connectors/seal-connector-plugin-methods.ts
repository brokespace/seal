import { defineMethod, type RpcContext } from '../../core'
import type { OrcadFeature } from '../../startup/orcad-readiness'
import { LOCAL_MACHINE_ID } from '../../../../../shared/machines/machine-types'
import {
  SealConnectorsCatalogParams,
  SealConnectorsInstallPluginParams,
  SealConnectorsRemovePluginParams
} from '../../../../../shared/rpc-contract/seal-connectors-params'
import { resolveMachineConnection } from '../../../../machines/machine-services'
import {
  getSealPluginLibrary,
  installSealPlugin,
  readSealConnectorsCatalog,
  removeSealPlugin
} from '../../../../seal-connectors/seal-connectors-plugins'

// Plugins run code on this host, so a phone never adds one.
function requireDesktopCaller({ clientKind }: Pick<RpcContext, 'clientKind'>): void {
  if (clientKind === 'mobile') {
    throw new Error('Only a Seal desktop can add or remove plugins.')
  }
}

async function localConnection() {
  const connection = resolveMachineConnection(LOCAL_MACHINE_ID)
  await connection.connect()
  return connection
}

const PLUGIN_METHOD_DEFINITIONS = [
  defineMethod({
    name: 'seal.connectors.catalog',
    permission: 'workspace',
    params: SealConnectorsCatalogParams,
    handler: async (params) =>
      readSealConnectorsCatalog(await localConnection(), { refresh: params?.refresh === true })
  }),
  defineMethod({
    name: 'seal.connectors.installPlugin',
    permission: 'accounts-admin',
    params: SealConnectorsInstallPluginParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return {
        config: await installSealPlugin(params, {
          connection: await localConnection(),
          library: getSealPluginLibrary()
        })
      }
    }
  }),
  defineMethod({
    name: 'seal.connectors.removePlugin',
    permission: 'accounts-admin',
    params: SealConnectorsRemovePluginParams,
    handler: async (params, context) => {
      requireDesktopCaller(context)
      return {
        config: await removeSealPlugin(params.pluginId, { library: getSealPluginLibrary() })
      }
    }
  })
]

export const SEAL_CONNECTOR_PLUGIN_METHODS = PLUGIN_METHOD_DEFINITIONS.map((method) => ({
  ...method,
  requires: ['accounts'] satisfies OrcadFeature[]
}))
