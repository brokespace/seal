// What a host answers about the jobs a scan asks it to find among its processes (`jobSection`).

/** A process no agent runs that matches a job the scan asked about. */
export type DiscoveredJob = {
  /** Which of the queries, by its place among them. */
  query: number
  /** Which of that query's names its command line carries. */
  name: number
  pid: number
  startedAtMs: number
  /** The executable's name, without its path or arguments. */
  command: string
}

const JOB_LINE = /^@@JOB(S)? (.*)$/gm

/**
 * `@@JOB query name pid start command` for each process found, closed by `@@JOBS count`. Null
 * when the host was not asked or could not list its processes, and when the count is off: a
 * listing whose first lines were cut off is no answer.
 */
export function discoveredJobsIn(stdout: string): DiscoveredJob[] | null {
  const jobs: DiscoveredJob[] = []
  let counted: number | null = null
  for (const [, closing, rest] of stdout.matchAll(JOB_LINE)) {
    const m = /^(\d+) (\d+) (\d+) (\d+) (.*)$/.exec(rest)
    if (closing) {
      counted = Number(rest)
    } else if (m) {
      jobs.push({
        query: Number(m[1]),
        name: Number(m[2]),
        pid: Number(m[3]),
        startedAtMs: Number(m[4]) * 1000,
        command: m[5].trim()
      })
    }
  }
  return counted === jobs.length ? jobs : null
}
