/** How many times one failing call may recur before the model is told, warned, then refused. */
const NOTE_AT = 2
const LAST_TRY_AT = 3
/** A call that keeps failing the same way with different arguments gets twice the room. */
const VARIED_FACTOR = 2

export const REPEATED_NOTE =
  'This is the same call failing the same way again. Repeating it will not help: change the arguments, use a different tool, or tell the user what is blocking you.'
export const LAST_TRY_NOTE =
  'This call has now failed the same way several times. It will not be run again this turn; take a different approach or report the problem to the user.'

export function stalledRefusal(tool: string): string {
  return `${tool} was not run: the identical call already failed repeatedly this turn. Take a different approach, or tell the user what is blocking you.`
}

function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`
  }
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => `${JSON.stringify(key)}:${stable(inner)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function callSignature(tool: string, input: unknown): string {
  return `${tool}:${stable(input)}`
}

/** The shape of a failure with its specifics removed, so "No such file a" and "…b" count as one. */
export function errorSignature(tool: string, message: string): string {
  const shape = message
    .slice(0, 300)
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '<v>')
    .replace(/(?:[A-Za-z]:)?[\\/][^\s:,)]+/g, '<path>')
    .replace(/\d+/g, '<n>')
    .trim()
  return `${tool}:${shape}`
}

export type RepeatVerdict = { note: string | null }

/** Per-turn memory of failing calls; a success clears the slate for that call. */
export class RepeatGuard {
  private readonly sameCall = new Map<string, number>()
  private readonly sameError = new Map<string, number>()

  /** True when the identical call has already exhausted its tries and must not run. */
  stalled(tool: string, input: unknown): boolean {
    return (this.sameCall.get(callSignature(tool, input)) ?? 0) >= LAST_TRY_AT
  }

  succeeded(tool: string, input: unknown): void {
    this.sameCall.delete(callSignature(tool, input))
  }

  failed(tool: string, input: unknown, message: string): RepeatVerdict {
    const call = callSignature(tool, input)
    const error = errorSignature(tool, message)
    const calls = (this.sameCall.get(call) ?? 0) + 1
    const errors = (this.sameError.get(error) ?? 0) + 1
    this.sameCall.set(call, calls)
    this.sameError.set(error, errors)
    if (calls >= LAST_TRY_AT || errors >= LAST_TRY_AT * VARIED_FACTOR) {
      return { note: LAST_TRY_NOTE }
    }
    if (calls >= NOTE_AT || errors >= NOTE_AT * VARIED_FACTOR) {
      return { note: REPEATED_NOTE }
    }
    return { note: null }
  }
}
