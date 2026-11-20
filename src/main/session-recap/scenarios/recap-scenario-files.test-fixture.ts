// The suite's files: scenarios, the model replies recorded for them, and which checks fail today.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RecapCassetteEntry, RecapPendingRequest } from './recap-scenario-model.test-fixture'
import { recapScenarioSchema, type RecapScenario } from './recap-scenario-schema.test-fixture'

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const SCENARIOS = join(FIXTURES, 'scenarios')
const CASSETTES = join(FIXTURES, 'cassettes')
const BASELINE = join(FIXTURES, 'baseline.json')

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

export async function loadRecapScenarios(): Promise<RecapScenario[]> {
  const files = (await readdir(SCENARIOS)).filter((file) => file.endsWith('.json')).sort()
  return Promise.all(
    files.map(async (file) => {
      const scenario = recapScenarioSchema.parse(await readJson(join(SCENARIOS, file)))
      if (`${scenario.id}.json` !== file) {
        throw new Error(`${file} holds the scenario "${scenario.id}"; the two must match`)
      }
      return scenario
    })
  )
}

/** The replies recorded for a scenario, by request key; empty when none were. */
export async function loadRecapCassette(
  scenarioId: string
): Promise<Map<string, RecapCassetteEntry>> {
  const entries: RecapCassetteEntry[] = await readFile(
    join(CASSETTES, `${scenarioId}.json`),
    'utf8'
  )
    .then((raw) => JSON.parse(raw))
    .catch(() => [])
  return new Map(entries.map((entry) => [entry.key, entry]))
}

export async function addToRecapCassette(
  scenarioId: string,
  added: readonly RecapCassetteEntry[]
): Promise<void> {
  const cassette = await loadRecapCassette(scenarioId)
  for (const entry of added) {
    cassette.set(entry.key, entry)
  }
  await writeJson(join(CASSETTES, `${scenarioId}.json`), [...cassette.values()])
}

/** A run's failing checks as the baseline names them; a passing run has none. */
export type RecapBaseline = Record<string, string[]>

export function loadRecapBaseline(): Promise<RecapBaseline> {
  return readFile(BASELINE, 'utf8')
    .then((raw): RecapBaseline => JSON.parse(raw))
    .catch(() => ({}))
}

export function saveRecapBaseline(baseline: RecapBaseline): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)))
  return writeJson(BASELINE, sorted)
}

/** A reply someone with access to the model got for a pending request. */
export type RecapRelayedReply = {
  contentHash: string
  model: string
  reply: string
  neurons?: number
}

/**
 * Files replies under the scenarios whose pending requests they answer. A reply is matched by the
 * hash of the request it was made for, so one made for an altered request is left out.
 */
export async function mergeRelayedRecapReplies(
  pendingPath: string,
  repliesPath: string
): Promise<{ merged: number; unanswered: number }> {
  // Neither file yet: this is the run that writes the first pending requests.
  const read = (path: string): Promise<string> => readFile(path, 'utf8').catch(() => '[]')
  const pending: RecapPendingRequest[] = JSON.parse(await read(pendingPath))
  const replies: RecapRelayedReply[] = JSON.parse(await read(repliesPath))
  const byScenario = new Map<string, RecapCassetteEntry[]>()
  let unanswered = 0
  for (const request of pending) {
    const reply = replies.find(
      (found) => found.contentHash === request.contentHash && found.model === request.model
    )
    if (!reply) {
      unanswered++
      continue
    }
    const entries = byScenario.get(request.scenario) ?? []
    entries.push({
      key: request.key,
      model: request.model,
      messages: request.messages,
      reply: reply.reply,
      ...(reply.neurons === undefined ? {} : { neurons: reply.neurons })
    })
    byScenario.set(request.scenario, entries)
  }
  for (const [scenarioId, entries] of byScenario) {
    await addToRecapCassette(scenarioId, entries)
  }
  return { merged: pending.length - unanswered, unanswered }
}

export { writeJson as writeRecapScenarioJson }
