import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeSecureJsonFile } from '../../../shared/secure-storage/secure-file'
import {
  isSealMcpApprovalPolicy,
  isSealMcpScope,
  type SealMcpClient,
  type SealMcpClientCreateArgs,
  type SealMcpClientCreated
} from '../../../shared/seal-mcp/seal-mcp-types'

const TOKEN_PATTERN = /^smcp_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/
const DEFAULT_CALLS_PER_MINUTE = 120
const MAX_CALLS_PER_MINUTE = 6_000
const MAX_NAME_LENGTH = 80
/** Last-use times change on every call; writing them this rarely keeps the disk quiet. */
const LAST_USED_PERSIST_MS = 60_000

type StoredClient = SealMcpClient & { secretHash: string }

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const numberOrNull = (value: unknown): number | null => (typeof value === 'number' ? value : null)

function parseStored(value: unknown): StoredClient | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.secretHash !== 'string') {
    return null
  }
  const scopes = Array.isArray(value.scopes) ? value.scopes.filter(isSealMcpScope) : []
  const machines = Array.isArray(value.machines)
    ? value.machines.filter((machine): machine is string => typeof machine === 'string')
    : null
  return {
    id: value.id,
    secretHash: value.secretHash,
    name: typeof value.name === 'string' ? value.name : value.id,
    scopes,
    machines,
    // An unreadable policy falls back to the strictest one.
    approval: isSealMcpApprovalPolicy(value.approval) ? value.approval : 'commands',
    allowRelay: value.allowRelay === true,
    callsPerMinute:
      typeof value.callsPerMinute === 'number' ? value.callsPerMinute : DEFAULT_CALLS_PER_MINUTE,
    createdAt: numberOrNull(value.createdAt) ?? 0,
    lastUsedAt: numberOrNull(value.lastUsedAt),
    revokedAt: numberOrNull(value.revokedAt)
  }
}

function publicClient({ secretHash: _secretHash, ...client }: StoredClient): SealMcpClient {
  return {
    ...client,
    scopes: [...client.scopes],
    machines: client.machines && [...client.machines]
  }
}

function cleanArgs(args: SealMcpClientCreateArgs): Omit<SealMcpClient, 'id' | 'createdAt'> {
  const name = args.name.trim().slice(0, MAX_NAME_LENGTH)
  if (!name) {
    throw new Error('Give the client a name')
  }
  const scopes = [...new Set(args.scopes.filter(isSealMcpScope))]
  if (scopes.length === 0) {
    throw new Error('Pick at least one scope; a client without scopes can do nothing')
  }
  const machines = args.machines ? [...new Set(args.machines.map((id) => id.trim()))] : null
  if (machines?.some((id) => !id)) {
    throw new Error('A machine id cannot be empty')
  }
  if (machines?.length === 0) {
    throw new Error('Pick at least one machine, or allow every machine')
  }
  const callsPerMinute = Math.round(args.callsPerMinute ?? DEFAULT_CALLS_PER_MINUTE)
  if (!(callsPerMinute >= 1 && callsPerMinute <= MAX_CALLS_PER_MINUTE)) {
    throw new Error(`Calls per minute must be between 1 and ${MAX_CALLS_PER_MINUTE}`)
  }
  return {
    name,
    scopes,
    machines,
    // Destructive calls wait for a person unless the user chose otherwise.
    approval: args.approval ?? 'destructive',
    allowRelay: args.allowRelay === true,
    callsPerMinute,
    lastUsedAt: null,
    revokedAt: null
  }
}

/** MCP clients and the hashes of their tokens. A token is shown once, when it is created. */
export class SealMcpClientStore {
  private readonly clients = new Map<string, StoredClient>()
  private lastUsedPersistedAt = 0

  constructor(
    private readonly path: string,
    private readonly onChange: () => void = () => {}
  ) {}

  /** Reads the saved clients. Until it resolves the store is empty, and a write would drop them. */
  async load(): Promise<void> {
    try {
      const saved: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      const list = isRecord(saved) && Array.isArray(saved.clients) ? saved.clients : []
      for (const client of list.map(parseStored)) {
        if (client) {
          this.clients.set(client.id, client)
        }
      }
    } catch {
      // Nothing saved yet, or an unreadable file: no client is trusted.
    }
  }

  list(): SealMcpClient[] {
    return [...this.clients.values()].map(publicClient).sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): SealMcpClient | null {
    const client = this.clients.get(id)
    return client ? publicClient(client) : null
  }

  create(args: SealMcpClientCreateArgs): SealMcpClientCreated {
    const id = randomBytes(6).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const stored: StoredClient = {
      ...cleanArgs(args),
      id,
      secretHash: hashSecret(secret),
      createdAt: Date.now()
    }
    this.clients.set(id, stored)
    this.save()
    return { client: publicClient(stored), token: `smcp_${id}_${secret}` }
  }

  /** A revoked client stays listed, so its audit entries keep a name. */
  revoke(id: string): boolean {
    const client = this.clients.get(id)
    if (!client || client.revokedAt !== null) {
      return false
    }
    client.revokedAt = Date.now()
    this.save()
    return true
  }

  remove(id: string): boolean {
    if (!this.clients.delete(id)) {
      return false
    }
    this.save()
    return true
  }

  /** The client a token belongs to, or null for a wrong, malformed or revoked token. */
  authenticate(token: string | null | undefined): SealMcpClient | null {
    const match = TOKEN_PATTERN.exec(token ?? '')
    const client = match ? this.clients.get(match[1]) : undefined
    // Hash even for an unknown id, so the answer takes the same time either way.
    const given = Buffer.from(hashSecret(match?.[2] ?? ''), 'hex')
    const wanted = Buffer.from(client?.secretHash ?? hashSecret('unknown'), 'hex')
    const matches = given.length === wanted.length && timingSafeEqual(given, wanted)
    if (!client || !matches || client.revokedAt !== null) {
      return null
    }
    client.lastUsedAt = Date.now()
    if (client.lastUsedAt - this.lastUsedPersistedAt > LAST_USED_PERSIST_MS) {
      this.save(false)
    }
    return publicClient(client)
  }

  private save(changed = true): void {
    this.lastUsedPersistedAt = Date.now()
    writeSecureJsonFile(this.path, { version: 1, clients: [...this.clients.values()] })
    if (changed) {
      this.onChange()
    }
  }
}
