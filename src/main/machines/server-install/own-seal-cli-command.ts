/** Runs the `seal` command a user installed on a machine and reads its `--json` answer. */
import { INSTALLED_CLI_COMMAND_NAME } from '../../cli/installation/cli-install-constants'
import { isRecord } from '../../home-chat/home-chat-record-guard'
import type { SshConnection } from '../../ssh/connection/ssh-connection'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { execInSshLoginShell } from '../../ssh/remote-exec/ssh-login-shell-exec'

/** The CLI's `--json` answer; null when the output holds none. */
function cliAnswer(output: string): Record<string, unknown> | null {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start === -1 || end < start) {
    return null
  }
  try {
    const answer: unknown = JSON.parse(output.slice(start, end + 1))
    return isRecord(answer) ? answer : null
  } catch {
    return null
  }
}

/**
 * Resolves with the answer's `result`. `whenNotFound` is the sentence that tells the user what to
 * do on the machine when the command is not on the PATH of their login shell.
 */
export async function runOwnSealCli(
  conn: SshConnection,
  args: string,
  options: { timeoutMs: number; whenNotFound: string }
): Promise<Record<string, unknown>> {
  const command = `${INSTALLED_CLI_COMMAND_NAME} ${args} --json`
  let stderr = ''
  // The user's own login shell holds the PATH that finds the CLI.
  const output = await execInSshLoginShell(conn, command, {
    timeoutMs: options.timeoutMs,
    onStderr: (chunk) => {
      stderr += chunk
    }
  })
    .then((run) => run?.stdout ?? '')
    .catch((error: unknown) => {
      if (!isSshCommandExitError(error)) {
        throw error
      }
      return error.stdout
    })
  const answer = cliAnswer(output)
  if (answer?.ok === true && isRecord(answer.result)) {
    return answer.result
  }
  if (answer && isRecord(answer.error) && typeof answer.error.message === 'string') {
    throw new Error(answer.error.message)
  }
  const said = `${stderr}\n${output}`.trim()
  if (/not found|unknown command/iu.test(said)) {
    throw new Error(
      `Seal's command-line tool was not found on this machine over SSH. ${options.whenNotFound}`
    )
  }
  throw new Error(
    `The machine did not answer "${command}"${said ? `: ${said.split(/\r?\n/u)[0]}` : ''}`
  )
}
