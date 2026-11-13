import { resolveSealPushOrigin } from '../../../shared/seal-cloud/seal-service-origins'

export function resolvePushGatewayOrigin(env: NodeJS.ProcessEnv, packaged: boolean): string {
  return resolveSealPushOrigin(env, packaged)
}
