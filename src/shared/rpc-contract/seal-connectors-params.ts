import * as z from 'zod'
import {
  AppliesToSchema,
  ProjectOverrideSchema,
  RefresherLeaseSchema,
  SealConnectorsConfigSchema,
  SignInSecretSchema
} from '../seal-connectors/seal-connectors-types'

const Id = z.string().trim().min(1).max(200)
const HostKey = z.string().trim().min(1).max(512)

export const SealConnectorsStatusParams = z.object({}).strict().nullish()

/** A desktop UI edit; dated by the host. */
export const SealConnectorsSetConfigParams = z
  .object({ config: SealConnectorsConfigSchema })
  .strict()

/** A desktop carries the fleet's list to a host; the newer of the two is kept and returned. */
export const SealConnectorsApplyConfigParams = z
  .object({ config: SealConnectorsConfigSchema })
  .strict()

export const SealConnectorsSignInVersionsParams = z.object({}).strict().nullish()

export const SealConnectorsExportSignInsParams = z.object({ ids: z.array(Id).max(200) }).strict()

export const SealConnectorsImportSignInsParams = z
  .object({ signIns: z.array(SignInSecretSchema).max(200) })
  .strict()

export const SealConnectorsSetLeaseParams = z.object({ lease: RefresherLeaseSchema }).strict()

export const SealConnectorsStartSignInParams = z
  .object({
    connectorId: Id,
    /** Reconnect this sign-in; null adds another one. */
    signInId: Id.nullable()
  })
  .strict()

export const SealConnectorsSubmitRedirectParams = z
  .object({ attemptId: Id, url: z.string().trim().min(1).max(8192) })
  .strict()

export const SealConnectorsAttemptParams = z.object({ attemptId: Id }).strict()

export const SealConnectorsSetStaticSecretParams = z
  .object({
    connectorId: Id,
    signInId: Id.nullable(),
    label: z.string().trim().max(120),
    headers: z.record(z.string().max(200), z.string().max(8192)),
    env: z.record(z.string().max(200), z.string().max(8192))
  })
  .strict()

export const SealConnectorsRemoveSignInParams = z.object({ connectorId: Id, signInId: Id }).strict()

export const SealConnectorsSetRefresherParams = z.object({ hostKey: HostKey.nullable() }).strict()

export const SealConnectorsCatalogParams = z
  .object({ refresh: z.boolean().optional() })
  .strict()
  .nullish()

export const SealConnectorsInstallPluginParams = z
  .object({
    name: Id,
    marketplace: Id,
    harness: z.enum(['claude', 'codex']),
    appliesTo: AppliesToSchema.optional(),
    projectOverrides: z.array(ProjectOverrideSchema).max(200).optional()
  })
  .strict()

export const SealConnectorsRemovePluginParams = z.object({ pluginId: Id }).strict()

export type SealConnectorsSignInStart =
  | { kind: 'url'; attemptId: string; url: string }
  | { kind: 'finished'; result: SealConnectorsSignInResult }

export type SealConnectorsSignInResult = {
  ok: boolean
  message: string | null
  signInId: string | null
}
