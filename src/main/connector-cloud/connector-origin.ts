import { cleanCloudServiceOrigin } from '../../shared/cloud-service-url'

/** Seal ships no hosted connector service; null means connectors stay off. */
export function resolveConnectorOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string | null {
  return cleanCloudServiceOrigin(env.SEAL_CONNECTOR_URL ?? env.ORCA_CONNECTOR_URL, !packaged)
}
