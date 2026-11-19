import * as z from 'zod'

const Id = z.string().trim().min(1).max(200)
const Key = z.string().trim().min(1).max(512)
const Label = z.string().trim().max(120)

/** `'all'` keeps picking up machines, accounts and harnesses added later. */
const ScopeSchema = z.union([z.literal('all'), z.array(Key).max(500)])
export type SealScope = z.infer<typeof ScopeSchema>

export const AppliesToSchema = z
  .object({
    /** `host:<installation id>` keys. */
    machines: ScopeSchema,
    /** Seal account keys (`claude:<email>`...). A launch with no Seal account matches only `'all'`. */
    accounts: ScopeSchema,
    /** Launchable agent ids (`claude`, `codex`, `grok`...). */
    harnesses: ScopeSchema
  })
  .strict()
export type AppliesTo = z.infer<typeof AppliesToSchema>

export const APPLIES_TO_ALL: AppliesTo = { machines: 'all', accounts: 'all', harnesses: 'all' }

/** Matches projects the same way Seal account project rules do (remote key, path, folder, globs). */
export const ProjectOverrideSchema = z
  .object({
    match: Key,
    /** Only on this machine (`host:` key); absent applies on every machine. */
    machine: Key.optional(),
    label: Label.optional(),
    state: z.enum(['on', 'off'])
  })
  .strict()
export type ProjectOverride = z.infer<typeof ProjectOverrideSchema>

const ScopedShape = {
  enabled: z.boolean(),
  appliesTo: AppliesToSchema,
  projectOverrides: z.array(ProjectOverrideSchema).max(200)
}

export const SERVER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export const ConnectorTransportSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('http'),
      url: z.url().max(2048),
      /** A pre-registered OAuth client (e.g. Slack's), as plugin `.mcp.json` files declare it. */
      oauth: z
        .object({
          clientId: z.string().max(512).optional(),
          callbackPort: z.number().int().min(1).max(65535).optional()
        })
        .strict()
        .optional()
    })
    .strict(),
  z
    .object({
      type: z.literal('stdio'),
      command: z.string().trim().min(1).max(1024),
      args: z.array(z.string().max(4096)).max(100),
      /** Non-secret values only; secrets live in a static sign-in. */
      env: z.record(z.string().max(200), z.string().max(4096))
    })
    .strict()
])
export type ConnectorTransport = z.infer<typeof ConnectorTransportSchema>

const HarnessSource = z.enum(['claude', 'codex'])

export const ConnectorSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), harness: HarnessSource, listing: Key }).strict(),
  z.object({ kind: z.literal('plugin'), pluginId: Id }).strict(),
  z.object({ kind: z.literal('custom') }).strict(),
  z.object({ kind: z.literal('imported'), fromHostKey: Key, fromHarness: HarnessSource }).strict()
])
export type ConnectorSource = z.infer<typeof ConnectorSourceSchema>

export const SignInRefSchema = z
  .object({
    ...ScopedShape,
    id: Id,
    label: Label,
    kind: z.enum(['oauth', 'static']),
    createdAt: z.number()
  })
  .strict()
export type SignInRef = z.infer<typeof SignInRefSchema>

export const ConnectorSchema = z
  .object({
    ...ScopedShape,
    id: Id,
    /** The MCP server name sessions see. */
    name: z.string().regex(SERVER_NAME_PATTERN),
    title: Label.min(1),
    transport: ConnectorTransportSchema,
    source: ConnectorSourceSchema,
    auth: z.enum(['none', 'oauth', 'static']),
    signIns: z.array(SignInRefSchema).max(50),
    disabledTools: z.array(z.string().max(200)).max(500)
  })
  .strict()
export type Connector = z.infer<typeof ConnectorSchema>

export const PluginEntrySchema = z
  .object({
    ...ScopedShape,
    /** `name@marketplace`. */
    id: Id,
    name: Id,
    marketplace: Id,
    harness: HarnessSource,
    version: z.string().max(120).nullable(),
    description: z.string().max(2000),
    connectorIds: z.array(Id).max(50),
    skillNames: z.array(Id).max(500)
  })
  .strict()
export type PluginEntry = z.infer<typeof PluginEntrySchema>

const SkillFileSchema = z
  .object({ path: z.string().min(1).max(512), base64: z.string().max(700_000) })
  .strict()

export const SkillEntrySchema = z
  .object({
    ...ScopedShape,
    id: Id,
    name: Id,
    description: z.string().max(2000),
    source: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('plugin'), pluginId: Id }).strict(),
      z.object({ kind: z.literal('library'), files: z.array(SkillFileSchema).max(200) }).strict()
    ])
  })
  .strict()
export type SkillEntry = z.infer<typeof SkillEntrySchema>

export const SealConnectorsConfigSchema = z
  .object({
    version: z.literal(1),
    /** Newest wins when machines sync. */
    updatedAt: z.number(),
    connectors: z.array(ConnectorSchema).max(500),
    plugins: z.array(PluginEntrySchema).max(500),
    skills: z.array(SkillEntrySchema).max(2000),
    refresher: z.object({ designatedHostKey: Key.nullable() }).strict(),
    /** Hosts whose own user-level MCP servers (codegraph...) were adopted into this list. */
    importedHosts: z.array(Key).max(500)
  })
  .strict()
export type SealConnectorsConfig = z.infer<typeof SealConnectorsConfigSchema>

export function emptySealConnectorsConfig(): SealConnectorsConfig {
  return {
    version: 1,
    updatedAt: 0,
    connectors: [],
    plugins: [],
    skills: [],
    refresher: { designatedHostKey: null },
    importedHosts: []
  }
}

/** Who refreshes OAuth tokens; the desktop hub moves it when the owner goes quiet. */
export const RefresherLeaseSchema = z
  .object({
    ownerHostKey: Key.nullable(),
    epoch: z.number().int().min(0),
    /** Last time the owner said it was alive (its own clock). */
    heartbeatAt: z.number(),
    /** The hub host that granted this lease. */
    grantedBy: Key.nullable()
  })
  .strict()
export type RefresherLease = z.infer<typeof RefresherLeaseSchema>

export const EMPTY_REFRESHER_LEASE: RefresherLease = {
  ownerHostKey: null,
  epoch: 0,
  heartbeatAt: 0,
  grantedBy: null
}

/** Claude Code's `mcpOAuth` entry, kept opaque apart from the fields Seal reads. */
export const McpOAuthEntrySchema = z.looseObject({
  serverName: z.string().max(512),
  serverUrl: z.string().max(2048),
  accessToken: z.string().max(65_536).optional(),
  refreshToken: z.string().max(65_536).optional(),
  expiresAt: z.number().optional(),
  clientId: z.string().max(1024).optional(),
  clientSecret: z.string().max(4096).optional(),
  scope: z.string().max(8192).optional()
})
export type McpOAuthEntry = z.infer<typeof McpOAuthEntrySchema>

export const SignInSecretSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('oauth'),
      id: Id,
      connectorId: Id,
      /** `<server>|<hash>` as Claude Code keyed it where it was signed in. */
      mcpOAuthKey: Key,
      entry: McpOAuthEntrySchema,
      /** When this token set was captured or refreshed; the newest wins everywhere. */
      updatedAt: z.number()
    })
    .strict(),
  z
    .object({
      kind: z.literal('static'),
      id: Id,
      connectorId: Id,
      headers: z.record(z.string().max(200), z.string().max(8192)),
      env: z.record(z.string().max(200), z.string().max(8192)),
      updatedAt: z.number()
    })
    .strict()
])
export type SignInSecret = z.infer<typeof SignInSecretSchema>

/** What a host can say about a sign-in without revealing it. */
export type SignInHostState = {
  id: string
  present: boolean
  updatedAt: number | null
  expiresAt: number | null
  needsReconnect: boolean
}

export type SealConnectorsHostStatus = {
  hostKey: string | null
  config: SealConnectorsConfig
  signIns: SignInHostState[]
  lease: RefresherLease
  /** True when this host may refresh right now (owns a confirmed lease). */
  refreshing: boolean
  relayPort: number | null
  plugins: { id: string; installed: boolean; path: string | null; error: string | null }[]
}
