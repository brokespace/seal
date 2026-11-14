import * as z from 'zod'
import {
  SEAL_PROVIDERS,
  SealAccountProfileSchema,
  SealAccountsConfigSchema,
  SealAutoSwapSettingsSchema
} from '../seal-accounts/seal-accounts-config'

const Provider = z.enum(SEAL_PROVIDERS)
const AccountRef = z.string().trim().min(1).max(512)

export const SealAccountsStatusParams = z
  .object({ refreshUsage: z.boolean().optional() })
  .strict()
  .nullish()

export const SealAccountsSetConfigParams = z.object({ config: SealAccountsConfigSchema }).strict()

/** The desktop that manages a fleet pushes its config and tells the host which machine it is. */
export const SealAccountsApplyFleetConfigParams = z
  .object({
    config: SealAccountsConfigSchema,
    machineKey: z.string().trim().min(1).max(512)
  })
  .strict()

export const SealAccountsSetProfileParams = z
  .object({ account: AccountRef, profile: SealAccountProfileSchema.nullable() })
  .strict()

export const SealAccountsSetAutoSwapParams = z
  .object({ provider: Provider, settings: SealAutoSwapSettingsSchema.partial() })
  .strict()

export const SealAccountsSetPolicyParams = z
  .object({
    scope: z.enum(['project', 'machine']),
    /** Project match pattern, or machine key (`local`, `runtime:<id>`, `ssh:<id>`). */
    target: z.string().trim().min(1).max(512),
    provider: Provider,
    label: z.string().trim().max(120).optional(),
    allow: z.array(AccountRef).max(200).optional(),
    default: AccountRef.nullable().optional(),
    remove: z.boolean().optional()
  })
  .strict()

export const SealAccountsSwapParams = z
  .object({
    provider: Provider,
    /** Omitted: run the auto-swap evaluation now, ignoring the cooldown. */
    account: AccountRef.optional()
  })
  .strict()

export const SealAccountsPickParams = z
  .object({
    provider: Provider,
    worktreeId: z.string().max(4096).optional(),
    account: AccountRef.optional()
  })
  .strict()

export const SealAccountsPinWorkspaceParams = z
  .object({
    worktreeId: z.string().min(1).max(4096),
    provider: Provider,
    account: AccountRef.nullable()
  })
  .strict()

export const SealAccountsChooseNextLaunchParams = z
  .object({
    repoId: z.string().min(1).max(4096),
    provider: Provider,
    /** Null clears a choice that was never used. */
    account: AccountRef.nullable()
  })
  .strict()

export const SealAccountsAddApiKeyParams = z
  .object({
    provider: Provider,
    label: z.string().trim().min(1).max(80),
    apiKey: z.string().trim().min(8).max(4096)
  })
  .strict()

export const SealAccountsRemoveApiKeyParams = z
  .object({ id: z.string().trim().min(1).max(64) })
  .strict()

export const SealAccountsSyncFleetParams = z
  .object({
    /** Paired server ids; kept for older CLIs. */
    environmentIds: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    /** Machines to push to, however each one connects. */
    machineIds: z.array(z.string().trim().min(1).max(512)).max(100).optional(),
    /** Logins to copy to those hosts; omitted pushes only the policy config. */
    accounts: z.array(AccountRef).max(100).optional()
  })
  .strict()
  .refine((params) => (params.environmentIds?.length ?? 0) + (params.machineIds?.length ?? 0) > 0, {
    message: 'Name at least one machine'
  })

export const SealAccountsImportCredentialParams = z.discriminatedUnion('provider', [
  z
    .object({
      provider: z.literal('claude'),
      email: z.string().trim().min(3).max(320),
      organizationUuid: z.string().max(128).nullable(),
      organizationName: z.string().max(256).nullable(),
      /** Claude Code's credentials JSON (`claudeAiOauth`), as its own login writes it. */
      credentialsJson: z
        .string()
        .min(2)
        .max(64 * 1024),
      /** The `oauthAccount` block from the login's `.claude.json`. */
      oauthAccountJson: z
        .string()
        .min(2)
        .max(64 * 1024)
    })
    .strict(),
  z
    .object({
      provider: z.literal('codex'),
      /** Codex's `auth.json`, as `codex login` writes it. */
      authJson: z
        .string()
        .min(2)
        .max(64 * 1024)
    })
    .strict()
])
export type SealAccountsImportCredential = z.infer<typeof SealAccountsImportCredentialParams>

/** Move one running session to another account (live, or by resuming it there). */
export const SealAccountsSwapSessionParams = z
  .object({
    sessionId: z.string().trim().min(1).max(128),
    account: AccountRef
  })
  .strict()

export const SealAccountsSetSessionLiveSwapParams = z
  .object({
    sessionId: z.string().trim().min(1).max(128),
    mode: z.enum(['inherit', 'on', 'off'])
  })
  .strict()

/** How fresh this host's copies of these logins are (expiry timestamps only, never tokens). */
export const SealAccountsCredentialFreshnessParams = z
  .object({ accounts: z.array(AccountRef).max(200) })
  .strict()

/** The managing desktop pulls back a login this host refreshed, so other copies can follow. */
export const SealAccountsExportCredentialParams = z.object({ account: AccountRef }).strict()

/** A Claude setup token (`claude setup-token`); stored like an API key, sealed by the OS keychain. */
export const SealAccountsAddSetupTokenParams = z
  .object({
    label: z.string().trim().min(1).max(80),
    token: z.string().trim().min(8).max(4096)
  })
  .strict()

export const SealAccountsRemoveAccountParams = z
  .object({
    account: AccountRef,
    provider: Provider.optional(),
    /** Also sign the machine's own CLI out, when the account is its login. */
    logout: z.boolean().optional()
  })
  .strict()

/** Lists the machine's own `claude`/`codex` login again after it was removed from Seal. */
export const SealAccountsImportSystemLoginParams = z.object({ provider: Provider }).strict()

/** The accounts of one provider in preference order; the first is tried first. */
export const SealAccountsReorderParams = z
  .object({ provider: Provider, accounts: z.array(AccountRef).min(1).max(200) })
  .strict()

export const SealAccountsDismissNoticeParams = z.object({}).strict().nullish()

export const SealAccountsSignInStartParams = z
  .object({
    provider: Provider,
    method: z.enum(['browser', 'device-code']),
    openBrowser: z.boolean(),
    account: AccountRef.optional()
  })
  .strict()

const FlowId = z.string().trim().min(1).max(128)

export const SealAccountsSignInWaitParams = z
  .object({ flowId: FlowId, afterRevision: z.number().int().min(0) })
  .strict()

export const SealAccountsSignInSubmitCodeParams = z
  .object({ flowId: FlowId, code: z.string().trim().min(1).max(2048) })
  .strict()

export const SealAccountsSignInCancelParams = z.object({ flowId: FlowId }).strict()
