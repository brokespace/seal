// A Codex code-mode `exec` call (0.162+) holds JavaScript: what it ran are the `tools.*` calls in it.

export type CodexExecCellCall = {
  /** The tool as the cell names it: `exec_command`, `apply_patch`, `write_stdin`. */
  tool: string
  /** A command's `cmd`, or the string a tool was called with; null when it was given neither. */
  text: string | null
}

// A cell may also call a tool it took off `tools` by name.
const TOOL_CALL = /\b(?:tools\.([A-Za-z_]\w*)|(exec_command|apply_patch|write_stdin))\(/g
const COMMAND_ARGUMENT = /^\s*\{[^}]*?\bcmd:\s*(["'`])((?:\\.|(?!\1).)*)\1/s
const STRING_ARGUMENT = /^\s*(["'`])((?:\\.|(?!\1).)*)\1/s
const ESCAPE = /\\(?:u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|(\r?\n)|([\s\S]))/g
const NAMED_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  0: '\0'
}

/** A JavaScript string literal's value, from the source between its quotes. */
function literalValue(body: string): string {
  return body.replace(ESCAPE, (_match, brace, unicode, hex, continuation, char) => {
    const code = brace ?? unicode ?? hex
    if (code) {
      return String.fromCodePoint(Number.parseInt(code, 16))
    }
    return continuation ? '' : (NAMED_ESCAPES[char] ?? char)
  })
}

/** The tool calls a code-mode cell makes, in the order it writes them. */
export function codexExecCellCalls(source: string): CodexExecCellCall[] {
  return [...source.matchAll(TOOL_CALL)].map((match) => {
    const tool = match[1] ?? match[2]
    const rest = source.slice(match.index + match[0].length)
    const argument = (tool === 'exec_command' ? COMMAND_ARGUMENT : STRING_ARGUMENT).exec(rest)
    return { tool, text: argument ? literalValue(argument[2]) : null }
  })
}
