import { randomUUID } from 'node:crypto'
import {
  referencedSignInIds,
  withStaticSignIn
} from '../../shared/seal-connectors/seal-connectors-config-edits'
import type { SignInHostState } from '../../shared/seal-connectors/seal-connectors-types'
import type { SealConnectorsService } from './seal-connectors-service'

/** Stores static headers/env as a sign-in of this connector and lists it; returns its id. */
export function setStaticSignIn(
  service: SealConnectorsService,
  args: {
    connectorId: string
    signInId: string | null
    label: string
    headers: Record<string, string>
    env: Record<string, string>
  },
  now: number = Date.now()
): string {
  const connector = service.config().connectors.find((entry) => entry.id === args.connectorId)
  if (!connector) {
    throw new Error('That connector no longer exists.')
  }
  const id = args.signInId ?? `si_${randomUUID()}`
  service.saveSignIn({
    kind: 'static',
    id,
    connectorId: connector.id,
    headers: args.headers,
    env: args.env,
    updatedAt: now
  })
  service.editConfig((config) =>
    withStaticSignIn(config, { connectorId: connector.id, signInId: id, label: args.label, now })
  )
  return id
}

/** Every sign-in the list names, with this host's reading of it. */
export function signInStates(service: SealConnectorsService): SignInHostState[] {
  return [...referencedSignInIds(service.config())].map((id) => {
    const secret = service.signIn(id)
    return {
      id,
      present: secret !== null,
      updatedAt: secret?.updatedAt ?? null,
      expiresAt:
        secret?.kind === 'oauth' && typeof secret.entry.expiresAt === 'number'
          ? secret.entry.expiresAt
          : null,
      needsReconnect: service.needsReconnect(id)
    }
  })
}
