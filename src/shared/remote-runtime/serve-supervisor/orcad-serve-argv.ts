/** Share the CLI’s exact Electron --serve-* and plain orcad argv with runtime tests; flags previously vanished at this boundary (#30120). */
import { ORCAD_LOOPBACK_BIND_HOST } from '../orcad-lifecycle/orcad-bind-address'

export type ServeOrcaAppArgs = {
  json?: boolean
  port?: string | null
  bind?: string | null
  pairingAddress?: string | null
  noPairing?: boolean
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  allowPublic?: boolean
  refusePublic?: boolean
  recipeJson?: boolean
  projectRoot?: string | null
  /** Starts Electron serve despite a remembered macOS startup abort in this environment. */
  force?: boolean
  /** Restart the server under a service manager instead of exiting with it; never inferred. */
  supervise?: boolean
}

/** Serialize optional serve flags for either the CLI or Electron's internal argv form. */
export function serveOptionArgs(args: ServeOrcaAppArgs, prefix: '--' | '--serve-'): string[] {
  return [
    ...(args.json ? [`${prefix}json`] : []),
    ...(args.port ? [`${prefix}port`, args.port] : []),
    ...(args.bind ? [`${prefix}bind`, args.bind] : []),
    ...(args.pairingAddress ? [`${prefix}pairing-address`, args.pairingAddress] : []),
    ...(args.noPairing ? [`${prefix}no-pairing`] : []),
    ...(args.mobilePairing ? [`${prefix}mobile-pairing`] : []),
    ...(args.grantDesktopControl ? [`${prefix}grant-desktop-control`] : []),
    ...(args.allowPublic ? [`${prefix}allow-public`] : []),
    ...(args.refusePublic ? [`${prefix}refuse-public`] : []),
    ...(args.recipeJson && args.projectRoot
      ? [`${prefix}recipe-json`, `${prefix}project-root`, args.projectRoot]
      : [])
  ]
}

/** Listens on loopback unless the operator names an address: reaching the network is never the default. */
export function orcadServeArgs(args: ServeOrcaAppArgs, webClientRoot?: string): string[] {
  const { bind, ...options } = args
  return [
    '--bind',
    bind ?? ORCAD_LOOPBACK_BIND_HOST,
    ...serveOptionArgs(options, '--'),
    ...(webClientRoot ? ['--web-client-root', webClientRoot] : [])
  ]
}
