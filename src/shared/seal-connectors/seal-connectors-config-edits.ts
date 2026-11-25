import { APPLIES_TO_ALL, type SealConnectorsConfig, type SignInRef } from './seal-connectors-types'

export function referencedSignInIds(config: SealConnectorsConfig): Set<string> {
  return new Set(
    config.connectors.flatMap((connector) => connector.signIns.map((signIn) => signIn.id))
  )
}

/** Lists a static sign-in on a connector (or renames the one listed); a keyless connector becomes static. */
export function withStaticSignIn(
  config: SealConnectorsConfig,
  edit: { connectorId: string; signInId: string; label: string; now: number }
): SealConnectorsConfig {
  return {
    ...config,
    connectors: config.connectors.map((connector) => {
      if (connector.id !== edit.connectorId) {
        return connector
      }
      const existing = connector.signIns.find((signIn) => signIn.id === edit.signInId)
      const label =
        edit.label || existing?.label || `${connector.title} ${connector.signIns.length + 1}`
      const added: SignInRef = {
        id: edit.signInId,
        label,
        kind: 'static',
        createdAt: edit.now,
        enabled: true,
        appliesTo: APPLIES_TO_ALL,
        projectOverrides: []
      }
      return {
        ...connector,
        auth: connector.auth === 'none' ? 'static' : connector.auth,
        signIns: existing
          ? connector.signIns.map((signIn) =>
              signIn.id === edit.signInId ? { ...signIn, label } : signIn
            )
          : [...connector.signIns, added]
      }
    })
  }
}

export function withoutSignIn(
  config: SealConnectorsConfig,
  connectorId: string,
  signInId: string
): SealConnectorsConfig {
  return {
    ...config,
    connectors: config.connectors.map((connector) =>
      connector.id === connectorId
        ? { ...connector, signIns: connector.signIns.filter((signIn) => signIn.id !== signInId) }
        : connector
    )
  }
}
