import { z } from 'zod'

// Replies for calls that could not run. Each says what went wrong and what to do next, because the
// model that reads it decides the next step on this text alone.

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = current
    }
  }
  return row[b.length]
}

/** Up to three tool names close to what the model asked for. */
export function nearestToolNames(name: string, known: readonly string[]): string[] {
  // CLI drivers namespace tools (`mcp__seal__run_command`, `seal.run_command`).
  const wanted = name.toLowerCase().replace(/^.*(__|\.|\/)/, '')
  return known
    .map((candidate) => ({
      candidate,
      score:
        candidate.includes(wanted) || wanted.includes(candidate)
          ? 0
          : editDistance(wanted, candidate)
    }))
    .filter(({ candidate, score }) => score <= Math.max(2, Math.floor(candidate.length / 3)))
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map(({ candidate }) => candidate)
}

export function unknownToolReply(name: string, known: readonly string[]): string {
  const near = nearestToolNames(name, known)
  const hint = near.length
    ? `Did you mean ${near.join(' or ')}?`
    : `The tools you have: ${known.join(', ')}.`
  return `There is no tool named "${name}", so nothing ran. ${hint}`
}

export function notAnObjectReply(tool: string): string {
  return `${tool} was not run: its arguments must be a JSON object with named fields. Call it again with an object.`
}

export function invalidArgumentsReply(tool: string, error: unknown): string {
  const problems =
    error instanceof z.ZodError
      ? error.issues
          .map((issue) => `- ${issue.path.join('.') || '(arguments)'}: ${issue.message}`)
          .join('\n')
      : `- ${error instanceof Error ? error.message : String(error)}`
  return `${tool} was not run: its arguments are invalid.\n${problems}\nFix the arguments and call it again.`
}

export function failureReply(tool: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `${tool} failed and did not complete: ${message}\nDo not repeat the identical call: change its arguments, use another tool, or continue without it.`
}
