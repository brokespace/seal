import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { writeSecureJsonFile } from '../../shared/secure-storage/secure-file'
import {
  parseSealAccountsConfig,
  type SealAccountKey,
  type SealAccountsConfig,
  type SealProvider
} from '../../shared/seal-accounts/seal-accounts-config'
import type {
  SealMigrationNotice,
  SealQuarantineEntry,
  SealSessionAssignment,
  SealSwapEvent,
  SealWorkspacePins
} from '../../shared/seal-accounts/seal-accounts-status'

const MAX_SWAP_LOG = 50
const MAX_SESSIONS = 200

export type SealAccountsLocalState = {
  /** Which machine this host is in the fleet's machine rules; the managing desktop names it. */
  machineKey: string
  quarantine: Record<string, SealQuarantineEntry>
  lastSwapAt: Partial<Record<SealProvider, number>>
  swapLog: SealSwapEvent[]
  sessions: SealSessionAssignment[]
  workspacePins: SealWorkspacePins
  /** Logins that also live on other machines: environment id (or `desktop`) → account keys. */
  fleetCopies: Record<string, SealAccountKey[]>
  /** The machine's own CLI logins the user removed from Seal; hidden until re-imported. */
  dismissedSystemLogins: SealAccountKey[]
  /** Set once saved accounts were merged into one list; the notice shows what was merged. */
  accountsMigration: { version: number; notice: SealMigrationNotice | null } | null
}

const LocalStateSchema = z.object({
  machineKey: z.string().min(1).catch('local'),
  quarantine: z.record(z.string(), z.object({ until: z.number(), reason: z.string() })).catch({}),
  lastSwapAt: z.record(z.string(), z.number()).catch({}),
  swapLog: z.array(z.any()).catch([]),
  sessions: z.array(z.any()).catch([]),
  workspacePins: z.record(z.string(), z.record(z.string(), z.string())).catch({}),
  fleetCopies: z.record(z.string(), z.array(z.string())).catch({}),
  dismissedSystemLogins: z.array(z.string()).catch([]),
  accountsMigration: z
    .object({ version: z.number(), notice: z.any().nullable().catch(null) })
    .nullable()
    .catch(null)
})

function emptyLocalState(): SealAccountsLocalState {
  return {
    machineKey: 'local',
    quarantine: {},
    lastSwapAt: {},
    swapLog: [],
    sessions: [],
    workspacePins: {},
    fleetCopies: {},
    dismissedSystemLogins: [],
    accountsMigration: null
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Read once at construction; every later read is served from memory. */
function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined
    }
    console.warn(`[seal-accounts] Ignoring unreadable ${path}:`, error)
    return undefined
  }
}

/** Seal's account metadata and this host's swap state; no secret is ever written here. */
export class SealAccountsStore {
  private config: SealAccountsConfig
  private state: SealAccountsLocalState

  constructor(private readonly dir: string) {
    this.config = parseSealAccountsConfig(readJson(this.configPath))
    const parsed = LocalStateSchema.safeParse(readJson(this.statePath) ?? {})
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: entries were written by this store from the typed shapes; malformed fields fall back above.
    this.state = parsed.success ? (parsed.data as SealAccountsLocalState) : emptyLocalState()
  }

  get configPath(): string {
    return join(this.dir, 'config.json')
  }

  get statePath(): string {
    return join(this.dir, 'state.json')
  }

  getConfig(): SealAccountsConfig {
    return this.config
  }

  getState(): Readonly<SealAccountsLocalState> {
    return this.state
  }

  saveConfig(config: SealAccountsConfig): void {
    this.config = config
    writeSecureJsonFile(this.configPath, config)
  }

  updateState(update: (state: SealAccountsLocalState) => void): void {
    const next = structuredClone(this.state)
    update(next)
    next.swapLog = next.swapLog.slice(-MAX_SWAP_LOG)
    next.sessions = next.sessions.slice(-MAX_SESSIONS)
    this.state = next
    try {
      writeSecureJsonFile(this.statePath, next)
    } catch (error) {
      // Swap bookkeeping must never block a launch; it is rebuilt from live usage.
      console.warn('[seal-accounts] Could not save account state:', error)
    }
  }
}
