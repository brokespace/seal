// Seeds Claude Code / Codex sessions the live-session scanner finds: a transcript in the app's
// isolated home plus, for a running session, a stub process whose command line names the session.
//
// The scanner reads the machine's whole process table. Stubs of another app instance on this
// machine show up here as `local:<provider>:pid-<pid>` (idle, untitled, cwd outside every
// workspace), so assert on seeded ids, never on section or machine counts.

import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect } from './orca-app'
import type {
  LiveSession,
  LiveSessionStatus
} from '../../../src/shared/live-sessions/live-session-types'

export type SeedProvider = 'claude' | 'codex'
/** What a running session can report; an ended one reports `done` (`errored` and a question it asked stay). */
export type SeedStatus = Exclude<LiveSessionStatus, 'done'>

export type SeedLiveSessionOptions = {
  /** Inside a workspace folder the session links to that workspace; anywhere else it stays unlinked. */
  cwd: string
  provider?: SeedProvider
  /** Codex has no fixture for `running-shell`, `waiting-subagent` and `waiting-task`. */
  status: SeedStatus
  /** Shown as the row title. Codex `idle` has none: its title is its first prompt. */
  title: string
  /** False seeds an ended session: a transcript and no process. */
  running?: boolean
  /** How long ago an ended session last wrote. Under 2 min it still reads as running; over 12 h it is not listed. */
  ageMs?: number
}

export type SeededLiveSession = {
  /** Registry id, `local:<provider>:<providerSessionId>`. */
  id: string
  provider: SeedProvider
  providerSessionId: string
  pid: number | null
  /** Writes the transcript of another status; the registry follows on its next scans. */
  setStatus(status: SeedStatus): Promise<void>
  /** Ends the session: kills the stub and back-dates the transcript, so it reads `done`. */
  stop(options?: { ageMs?: number }): Promise<void>
}

export type SeedWorkspace = { id: string; path: string; name: string }

type Recipe = {
  fixture: string
  /** Only the fixture's opening record is kept: a session that has had no turn. */
  noTurn?: true
  /** No prompt can hold the pending call, so it stays `working` with no command running. */
  neverAsks?: true
  /** The stub runs a shell, which the scanner reads as the pending call's command. */
  shell?: true
}

// Each status is the one session-status-fixtures.test.ts reads from the same fixture.
const RECIPES: Record<SeedProvider, Partial<Record<SeedStatus, Recipe>>> = {
  claude: {
    'needs-permission': { fixture: 'live-claude-approval-pending' },
    'waiting-input': { fixture: 'claude-asks-question' },
    errored: { fixture: 'claude-errored' },
    working: { fixture: 'claude-working', neverAsks: true },
    'running-shell': { fixture: 'live-claude-shell-pending', shell: true },
    'waiting-subagent': { fixture: 'claude-waiting-foreground-subagent' },
    'waiting-task': { fixture: 'claude-waiting-background-task' },
    'your-turn': { fixture: 'claude-idle' },
    idle: { fixture: 'claude-idle', noTurn: true }
  },
  codex: {
    'needs-permission': { fixture: 'codex-needs-permission' },
    'waiting-input': { fixture: 'codex-asks-question' },
    errored: { fixture: 'codex-errored' },
    working: { fixture: 'codex-working', neverAsks: true },
    'your-turn': { fixture: 'codex-idle' },
    idle: { fixture: 'codex-idle', noTurn: true }
  }
}

const FIXTURES = path.join(process.cwd(), 'src/main/live-sessions/discovery/__fixtures__')
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const STAMP = /"timestamp":"([^"]+)"/g
/** A running session's last write: older than every prompt and settle delay in session-status.ts. */
const QUIET_MS = 20_000
const ENDED_AGE_MS = 10 * 60_000

// Exits when its stdin closes, so a dead test worker leaves no stub behind. The shell only reads
// a pipe the stub holds: it ends with the stub and has no child of its own to orphan.
const STUB_SOURCE = `const { spawn } = require('node:child_process')
let shell = null
process.stdin.on('data', (chunk) => {
  const run = String(chunk).includes('no-shell') ? false : String(chunk).includes('shell') ? true : null
  if (run === true && !shell) shell = spawn('sh', ['-c', 'read line'], { stdio: ['pipe', 'ignore', 'ignore'] })
  if (run === false && shell) { shell.kill('SIGKILL'); shell = null }
})
process.stdin.on('end', () => process.exit(0))
`

type Seeded = {
  provider: SeedProvider
  providerSessionId: string
  cwd: string
  title: string
  home: string
  /** Fixture ids to this session's, kept across rewrites. */
  ids: Map<string, string>
  transcript: string | null
  writes: number
  child: ChildProcess | null
}

const stubs = new Set<ChildProcess>()
const homes = new WeakMap<ElectronApplication, Promise<string>>()
let stubPath: string | null = null

function recipeFor(provider: SeedProvider, status: SeedStatus): Recipe {
  const recipe = RECIPES[provider][status]
  if (!recipe) {
    throw new Error(`No ${provider} transcript fixture yields "${status}"`)
  }
  return recipe
}

/** The fixture's records, cut or prefixed as the recipe asks. Only real record types are added. */
function fixtureText(session: Seeded, recipe: Recipe): string {
  const lines = fs
    .readFileSync(path.join(FIXTURES, `${recipe.fixture}.jsonl`), 'utf8')
    .trimEnd()
    .split('\n')
  const first: Record<string, unknown> & { payload?: { cwd?: string } } = JSON.parse(lines[0])
  const add = (at: number, drop: number, ...records: Record<string, unknown>[]) =>
    lines.splice(at, drop, ...records.map((record) => JSON.stringify(record)))
  if (session.provider === 'claude') {
    if (recipe.noTurn) {
      // Only a slash command ran; the title then comes from the summary record.
      const message = { role: 'user', content: '<command-name>/status</command-name>' }
      const summary = { type: 'summary', summary: session.title, leafUuid: first.uuid }
      add(0, lines.length, { ...first, isMeta: true, message }, summary)
    }
    if (recipe.neverAsks) {
      const permissionMode = 'bypassPermissions'
      add(0, 0, { type: 'permission-mode', permissionMode, sessionId: first.sessionId })
    }
  } else {
    lines.length = recipe.noTurn ? 1 : lines.length
    if (recipe.neverAsks) {
      const payload = { cwd: first.payload?.cwd, approval_policy: 'never' }
      add(1, 0, { timestamp: first.timestamp, type: 'turn_context', payload })
    }
  }
  return `${lines.join('\n')}\n`
}

/** Fixture text with this session's ids and cwd, its first prompt as `title`, its timestamps moved by `shift`. */
function retarget(text: string, session: Seeded, shift: number, title: string | null): string {
  const sessionId = /"(?:sessionId|payload":\{"id)":"([0-9a-f-]{36})"/.exec(text)?.[1]
  const cwd = /"cwd":("[^"]+")/.exec(text)?.[1]
  const prompt = /"role":"user","content":(?:\[\{"type":"input_text","text":)?("[^"]+")/.exec(text)
  if (sessionId) {
    session.ids.set(sessionId, session.providerSessionId)
  }
  let out = cwd ? text.replaceAll(`"cwd":${cwd}`, `"cwd":${JSON.stringify(session.cwd)}`) : text
  if (prompt && title !== null) {
    out = out.replaceAll(prompt[1], JSON.stringify(title))
  }
  // Record ids too: two transcripts sharing them read as one resumed conversation.
  out = out.replace(UUID, (id) => {
    const mapped = session.ids.get(id) ?? randomUUID()
    session.ids.set(id, mapped)
    return mapped
  })
  const moved = (at: string): string => new Date(Date.parse(at) + shift).toISOString()
  return out.replace(STAMP, (_, at: string) => `"timestamp":"${moved(at)}"`)
}

function writeAt(file: string, text: string, atMs: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  fs.utimesSync(file, atMs / 1000, atMs / 1000)
}

/** Every write is a new file: the scanner then reads it whole instead of folding it onto the last one. */
function writeTranscript(session: Seeded, status: SeedStatus, lastAt: number): void {
  const recipe = recipeFor(session.provider, status)
  const text = fixtureText(session, recipe)
  const shift = lastAt - Math.max(...[...text.matchAll(STAMP)].map((m) => Date.parse(m[1])))
  const previous = session.transcript
  const tag = `seed-${++session.writes}`
  const id = session.providerSessionId
  const file =
    session.provider === 'claude'
      ? path.join(
          session.home,
          '.claude/projects',
          `${session.cwd.replace(/[^a-zA-Z0-9]/g, '-')}-${tag}`,
          `${id}.jsonl`
        )
      : path.join(
          session.home,
          '.codex/sessions',
          ...new Date(lastAt).toISOString().slice(0, 10).split('-'),
          `rollout-${tag}-${id}.jsonl`
        )
  writeAt(file, retarget(text, session, shift, session.title), lastAt)
  const subagents = path.join(FIXTURES, `${recipe.fixture}.subagents`)
  for (const entry of fs.existsSync(subagents) ? fs.readdirSync(subagents) : []) {
    const body = fs.readFileSync(path.join(subagents, entry), 'utf8')
    const copy = entry.endsWith('.jsonl') ? retarget(body, session, shift, null) : body
    writeAt(path.join(file.replace(/\.jsonl$/, ''), 'subagents', entry), copy, lastAt)
  }
  session.transcript = file
  // Removed only after its successor exists: a scan in between must not find the process bare.
  if (previous) {
    fs.rmSync(previous, { force: true })
    fs.rmSync(previous.replace(/\.jsonl$/, ''), { recursive: true, force: true })
  }
  session.child?.stdin?.write(recipe.shell ? 'shell\n' : 'no-shell\n')
}

function kill(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    child.once('exit', () => resolve())
    child.kill('SIGKILL')
  })
}

export async function seedLiveSession(
  electronApp: ElectronApplication,
  options: SeedLiveSessionOptions
): Promise<SeededLiveSession> {
  const provider = options.provider ?? 'claude'
  recipeFor(provider, options.status)
  const home = homes.get(electronApp) ?? electronApp.evaluate(({ app }) => app.getPath('home'))
  homes.set(electronApp, home)
  const session: Seeded = {
    provider,
    providerSessionId: randomUUID(),
    cwd: options.cwd,
    title: options.title,
    home: await home,
    ids: new Map(),
    transcript: null,
    writes: 0,
    child: null
  }
  const running = options.running !== false
  if (running) {
    if (!stubPath) {
      stubPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-agent-')), 'stub.cjs')
      fs.writeFileSync(stubPath, STUB_SOURCE)
    }
    // `ps` shows argv[0]: `claude <stub> --session-id <uuid>` / `codex <stub> resume <uuid>`.
    session.child = spawn(
      process.execPath,
      [stubPath, provider === 'claude' ? '--session-id' : 'resume', session.providerSessionId],
      { argv0: provider, cwd: options.cwd, stdio: ['pipe', 'ignore', 'ignore'] }
    )
    session.child.unref()
    stubs.add(session.child)
  }
  const endedAt = (ageMs = ENDED_AGE_MS): number => Date.now() - ageMs
  writeTranscript(session, options.status, running ? Date.now() - QUIET_MS : endedAt(options.ageMs))
  let status = options.status
  return {
    id: `local:${provider}:${session.providerSessionId}`,
    provider,
    providerSessionId: session.providerSessionId,
    pid: session.child?.pid ?? null,
    setStatus: async (next) => {
      status = next
      writeTranscript(session, next, Date.now() - QUIET_MS)
    },
    stop: async (stopOptions) => {
      await kill(session.child)
      session.child = null
      writeTranscript(session, status, endedAt(stopOptions?.ageMs))
    }
  }
}

/** Kills every stub this test process started. Call from afterEach or a finally block. */
export async function stopAllSeededSessions(): Promise<void> {
  const running = [...stubs]
  stubs.clear()
  await Promise.all(running.map(kill))
}

/** Scans now and returns what the registry lists. A scan already under way is not waited for. */
export async function refreshLiveSessions(page: Page): Promise<LiveSession[]> {
  return page.evaluate(async () => {
    await window.api.liveSessions.refresh()
    return (await window.api.liveSessions.snapshot()).sessions
  })
}

/**
 * Rescans until the registry lists every id with its status. A session leaving a busy status is
 * held for one more scan (live-session-status-hold.ts), so one refresh is not always enough.
 */
export async function waitForLiveSessions(
  page: Page,
  expected: Readonly<Record<string, LiveSessionStatus>>,
  options: { timeout?: number } = {}
): Promise<void> {
  const ids = Object.keys(expected)
  await expect
    .poll(
      async () => {
        const byId = new Map((await refreshLiveSessions(page)).map((s) => [s.id, s.status]))
        return Object.fromEntries(ids.map((id) => [id, byId.get(id) ?? 'missing']))
      },
      { timeout: options.timeout ?? 30_000, message: 'seeded live sessions never settled' }
    )
    .toEqual(expected)
}

/** Adds workspaces (git worktrees) to the app's first project, the fixture's seeded repo. */
export async function addSeedWorkspaces(page: Page, count: number): Promise<SeedWorkspace[]> {
  return page.evaluate(
    async ({ count, prefix }) => {
      const state = window.__store!.getState()
      const repoId = state.repos[0].id
      const created: { id: string; path: string; name: string }[] = []
      for (let index = 1; index <= count; index++) {
        const name = `${prefix}-${index}`
        const { worktree } = await state.createWorktree(repoId, name, undefined, 'skip')
        created.push({ id: worktree.id, path: worktree.path, name: worktree.displayName })
      }
      await state.fetchWorktrees(repoId)
      return created
    },
    { count, prefix: `seed-${randomUUID().slice(0, 8)}` }
  )
}

/** The seeded repo outlives the test: remove what `addSeedWorkspaces` added. */
export async function removeSeedWorkspaces(
  page: Page,
  workspaces: readonly SeedWorkspace[]
): Promise<void> {
  const ids = workspaces.map((workspace) => workspace.id)
  await page.evaluate(async (ids) => {
    const state = window.__store!.getState()
    for (const id of ids) {
      const executionHostId = state.getKnownWorktreeById(id)?.hostId ?? null
      await state.removeWorktree({ id, executionHostId }, true)
    }
  }, ids)
}
