import { describe, expect, it } from 'vitest'
import { sshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'
import { serverInstallFailureReason } from './machine-server-install-failure'

const UNPACK_COMMAND =
  "trap '' HUP PIPE; orca_store_out=$(cd '/home/dev/.orca-remote/runtimes/stage' || exit 1 && " +
  "tar -xzf '/home/dev/.orca-remote/runtimes/stage/node.tar.gz' 'node/bin/node' || " +
  '{ echo ORCA_NODE_RUNTIME_EXTRACT_FAILED; exit 1; } && echo ORCA_NODE_RUNTIME_READY); ' +
  'orca_store_status=$?; printf \'%s\\n\' "$orca_store_out"; exit $orca_store_status'

function commandFailure(stderr: string, stdout = ''): Error {
  return sshCommandExitError(UNPACK_COMMAND, 1, stdout, [stderr, stdout].filter(Boolean).join('\n'))
}

/** How the connect flow hands over a setup that threw: only the error's message is left. */
function failedSetup(error: Error): unknown {
  return { route: 'unserved', reason: 'failed', detail: error.message }
}

const NO_TAR =
  'the machine has no “tar” program, which Seal needs to unpack its server. Install tar there, then try again'
const FOLDER_IS_A_FILE =
  '~/.orca-remote on the machine is a file, not a folder, so Seal cannot put its server there. Move or delete that file, then try again'

describe('serverInstallFailureReason', () => {
  it.each<[string, unknown, string]>([
    [
      'no tar on the machine (dash)',
      failedSetup(commandFailure('sh: 1: tar: not found', 'ORCA_NODE_RUNTIME_EXTRACT_FAILED')),
      NO_TAR
    ],
    [
      'no tar on the machine (bash), as the thrown error',
      commandFailure('bash: line 1: tar: command not found', 'ORCA_NODE_RUNTIME_EXTRACT_FAILED'),
      NO_TAR
    ],
    [
      'no tar on the machine (zsh)',
      failedSetup(commandFailure('zsh:1: command not found: tar')),
      NO_TAR
    ],
    [
      '~/.orca-remote is a regular file',
      failedSetup(
        new Error(
          "orcad could not claim this host's .orca-remote: could not create ~/.orca-remote: " +
            'mkdir: cannot create directory ‘/home/dev/.orca-remote’: File exists. ' +
            'Check that ~/.orca-remote belongs to this user and is writable, and that its filesystem ' +
            '(an NFS or other network home included) is mounted read-write and not over quota, then reconnect.'
        )
      ),
      FOLDER_IS_A_FILE
    ],
    [
      'a path below ~/.orca-remote, which is a regular file',
      failedSetup(
        commandFailure(
          'mkdir: cannot create directory ‘/home/dev/.orca-remote/runtimes’: Not a directory'
        )
      ),
      FOLDER_IS_A_FILE
    ],
    [
      'no gzip on the machine, which tar reports before its own last line',
      failedSetup(
        commandFailure(
          'tar (child): gzip: Cannot exec: No such file or directory\n' +
            'tar (child): Error is not recoverable: exiting now\n' +
            'tar: Child returned status 2\n' +
            'tar: Error is not recoverable: exiting now',
          'ORCA_NODE_RUNTIME_EXTRACT_FAILED'
        )
      ),
      'the machine has no “gzip” program, which Seal needs to unpack its server. Install gzip there, then try again'
    ],
    [
      '~/.orca-remote cannot be created for a reason Seal has no words for',
      failedSetup(
        new Error(
          "orcad could not claim this host's .orca-remote: could not create ~/.orca-remote: " +
            "mkdir: cannot create directory '/home/dev/.orca-remote': Input/output error. " +
            'Check that ~/.orca-remote belongs to this user and is writable, and that its filesystem ' +
            '(an NFS or other network home included) is mounted read-write and not over quota, then reconnect.'
        )
      ),
      'the machine could not prepare ~/.orca-remote for the server (“Input/output error”)'
    ],
    [
      'a failed command whose output is only markers',
      failedSetup(commandFailure('', 'ORCA_NODE_RUNTIME_HASH_MISMATCH')),
      'the install command failed on the machine'
    ],
    [
      'a failed command with a short line from the machine',
      failedSetup(commandFailure('gzip: stdin: unexpected end of file')),
      'the machine reported “gzip: stdin: unexpected end of file”'
    ],
    [
      'a command that timed out',
      failedSetup(new Error(`Command "${UNPACK_COMMAND}" timed out after 30s`)),
      'the machine did not finish the install command in time'
    ],
    [
      'a message that names internals',
      failedSetup(new Error('orcad host record read returned no verifiable answer')),
      'the install did not finish'
    ]
  ])('%s', (_name, failure, expected) => {
    expect(serverInstallFailureReason(failure)).toBe(expected)
  })
})

describe('serverInstallFailureReason for missing server files', () => {
  const looked = 'looked in C:\\Seal\\resources\\orcad-template, C:\\Seal\\out\\orcad-template'

  it('names where the server files were looked for', () => {
    expect(
      serverInstallFailureReason({
        route: 'unserved',
        reason: 'orcad_unavailable',
        detail: 'artifacts_unavailable',
        cause: looked
      })
    ).toBe(`this copy of Seal does not include the server files (${looked})`)
  })

  it('keeps the fixed reason alone when no cause came with it', () => {
    expect(
      serverInstallFailureReason({
        route: 'unserved',
        reason: 'orcad_unavailable',
        detail: 'artifacts_unavailable'
      })
    ).toBe('this copy of Seal does not include the server files')
  })
})
