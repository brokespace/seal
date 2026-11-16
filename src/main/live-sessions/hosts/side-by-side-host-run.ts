import type { LiveSessionHost } from './live-session-hosts'

type Gathering = { scripts: string[]; outputs: Promise<string[]> }

function sideBySideScript(scripts: readonly string[]): string {
  return [
    ...scripts.map((script, index) => `(\n${script}\n) | sed 's/^/${index} /' &`),
    'wait'
  ].join('\n')
}

function outputsOf(output: string, count: number): string[] {
  const outputs = Array.from({ length: count }, () => '')
  for (const line of output.split('\n')) {
    const tagged = /^(\d+) (.*)$/.exec(line)
    if (tagged) {
      outputs[Number(tagged[1])] += `${tagged[2]}\n`
    }
  }
  return outputs
}

/**
 * Gives each machine a `run` that puts the scripts asked of it in one turn into ONE run, side by
 * side, each with its own output back. An SSH connection has few channels (sshd's MaxSessions),
 * so a run per session would starve it. For scripts that print little: each one's output is
 * written whole when it ends.
 */
export function sideBySideHosts(): (host: LiveSessionHost | null) => LiveSessionHost | null {
  const gatherings = new Map<string, Gathering>()
  const run = (host: LiveSessionHost, script: string): Promise<string> => {
    const { hostId } = host.machine
    let gathering = gatherings.get(hostId)
    if (!gathering) {
      const scripts: string[] = []
      const outputs = Promise.resolve().then(() => {
        gatherings.delete(hostId)
        return scripts.length === 1
          ? host.run(scripts[0]).then((output) => [output])
          : host.run(sideBySideScript(scripts)).then((output) => outputsOf(output, scripts.length))
      })
      gathering = { scripts, outputs }
      gatherings.set(hostId, gathering)
    }
    const index = gathering.scripts.push(script) - 1
    return gathering.outputs.then((outputs) => outputs[index])
  }
  return (host) => host && { ...host, run: (script) => run(host, script) }
}
