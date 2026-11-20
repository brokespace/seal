import { FAKE_DOCKER_CLI_COMMANDS } from './fake-docker-cli-commands'
import { FAKE_DOCKER_CLI_OUTPUT } from './fake-docker-cli-output'

/**
 * A stateful stand-in for the `docker` CLI, for machines with no Docker to test on. It answers the
 * commands Seal runs with the output Docker 29 prints for them, and removals change what later
 * listings show. Install `fakeDockerCliScript()` as `docker` on a PATH with a state file named
 * `FAKE_DOCKER_STATE_FILE` beside it (or at `$SEAL_FAKE_DOCKER_STATE`). It needs `node`.
 */
export const FAKE_DOCKER_STATE_FILE = 'docker-state.json'

/** The text of a Node script to install as `docker`. */
export function fakeDockerCliScript(): string {
  return (FAKE_DOCKER_CLI_OUTPUT + FAKE_DOCKER_CLI_COMMANDS).replace(
    'STATE_FILE_NAME',
    FAKE_DOCKER_STATE_FILE
  )
}
