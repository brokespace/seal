/** Layers listed before "Show all" is pressed; a deep image has hundreds. */
export const MACHINE_DOCKER_LAYERS_SHOWN = 50

/**
 * The build step as it was written in the Dockerfile. `docker history` wraps a classic build's
 * steps in the shell that ran them: `/bin/sh -c #(nop) ADD …` for an instruction, `/bin/sh -c …`
 * for a `RUN`; BuildKit marks its own with a trailing `# buildkit`.
 */
export function dockerLayerStep(createdBy: string): string {
  const step = createdBy.trim().replace(/\s+# buildkit$/, '')
  const instruction = /^\/bin\/sh -c #\(nop\)\s+(.*)$/s.exec(step)
  if (instruction) {
    return instruction[1].trim()
  }
  const run = /^(?:RUN )?\/bin\/sh -c\s+(.*)$/s.exec(step)
  return run ? `RUN ${run[1].trim()}` : step
}
