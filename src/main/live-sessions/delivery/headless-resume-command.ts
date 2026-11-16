import type { LiveSession } from '../../../shared/live-sessions/live-session-types'

const RESUME_TURN_LIMIT_S = 2 * 60 * 60

export const B64_DECODE = '{ base64 -d 2>/dev/null || base64 -D; }'

export function shQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** Ends the script while the resume started as `pid` still runs: a second one beside it would fork the conversation. */
export function unlessResumeRuns(pid: number | undefined, command: string): string {
  return pid === undefined
    ? command
    : `kill -0 ${pid} 2>/dev/null && { echo "@@RUNNING"; exit 0; }; ${command}`
}

/**
 * A closed session: the CLI resumes it headless, which appends to the same transcript. `run` is
 * the agent's own one-shot command, given the quoted session id; the message is in `$T`.
 */
export function headlessResumeCommand(
  session: LiveSession,
  text: string,
  agent: { binary: string; run: (quotedSessionId: string) => string }
): string {
  const b64 = shQuote(Buffer.from(text, 'utf8').toString('base64'))
  const cwd = session.cwd ? `cd ${shQuote(session.cwd)} 2>/dev/null; ` : ''
  // A clean environment: Seal's own CLAUDECODE/CLAUDE_CODE_* would make the child think it's nested.
  return (
    `${cwd}T=$(printf %s ${b64} | ${B64_DECODE}); ` +
    `command -v ${agent.binary} >/dev/null 2>&1 || { echo "@@MISSING"; exit 0; }; ` +
    // One turn, then it exits; the time limit ends a turn that hangs instead of leaving it behind.
    `TO=$(command -v timeout || command -v gtimeout); ` +
    `nohup env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT \${TO:+"$TO" ${RESUME_TURN_LIMIT_S}} ${agent.run(shQuote(session.providerSessionId))} </dev/null >/dev/null 2>&1 & echo "@@STARTED $!"`
  )
}
