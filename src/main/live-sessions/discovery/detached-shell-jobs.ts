// Jobs a shell command leaves running after it returns (`nohup`, `setsid`, `&`, a detached tmux
// or screen), read off the command's wording, and the jobs a reply names.

const QUOTED = /'[^']*'|"(?:[^"\\]|\\.)*"/g
const DETACHING_WORD = /(?:^|[\s;&|(])(?:nohup|setsid|disown)(?=[\s;]|$)/
const DETACHED_TERMINAL =
  /\btmux\b[^\n;|]*\s(?:new-session|new|new-window|neww|send-keys)\b|\bscreen\s+(?:-\S+\s+)*-d(?:m|\s+-m)/
/** `&` as the shell's background operator: not `&&`, `&>`, `>&`, `<&` or `|&`. */
const BACKGROUND_OPERATOR = /(?<![&|<>])&(?![&>])/

/** Whether a command, run to its end in the foreground, can leave a job of its own running. */
export function leavesJobRunning(command: string): boolean {
  const bare = command.replace(QUOTED, "''")
  return DETACHING_WORD.test(bare) || DETACHED_TERMINAL.test(bare) || BACKGROUND_OPERATOR.test(bare)
}

const SCRIPT_NAME = /\.(?:py|sh|bash|zsh|js|mjs|cjs|ts|rb|pl|php|jl|R|lua|jar)$/
const REDIRECT = /\d*[<>]+&?\s*[^\s;|&()]+/g
const WORD_BREAK = /[\s;|&()'"`=]+/
/** What a host is asked to find: it goes into a shell script, so nothing a shell would read. */
const SAFE_NAME = /^[A-Za-z0-9_][\w.+-]{2,63}$/
/** What starts or wraps a job without being it, and the shell's own words. */
const NOT_THE_JOB: ReadonlySet<string> = new Set(
  (
    'nohup setsid disown nice ionice numactl taskset chrt env sudo doas exec command time ' +
    'timeout stdbuf unbuffer script tmux screen bash zsh dash ksh fish source echo printf export ' +
    'sleep wait true false kill pkill pgrep tee cat tail head grep while until for then else ' +
    'done new-session new-window send-keys null'
  ).split(' ')
)
const MAX_JOB_NAMES = 4

const baseName = (word: string): string => word.slice(word.lastIndexOf('/') + 1)

/**
 * The words of a command that its job's own command line will carry: the scripts it names, else
 * the programs it runs. A host matches them against its processes without sending a line back.
 */
export function detachedJobNames(command: string): string[] {
  const words = command.replace(REDIRECT, ' ').split(WORD_BREAK)
  const scripts: string[] = []
  const programs: string[] = []
  for (const word of words) {
    const name = baseName(word)
    if (!SAFE_NAME.test(name) || /^\d+$/.test(name) || NOT_THE_JOB.has(name)) {
      continue
    }
    if (SCRIPT_NAME.test(name) || /^\.{0,2}\/./.test(word)) {
      scripts.push(name)
    } else {
      programs.push(name)
    }
  }
  return [...new Set(scripts.length > 0 ? scripts : programs)].slice(0, MAX_JOB_NAMES)
}

/** Scripts that run as jobs; a reply names source files of other kinds all the time. */
const NAMED_SCRIPT = /(?<![\w.-])[\w.+-]*\w\.(?:py|sh|bash|zsh|rb|pl|jl|R|lua|jar)\b/g
const NAMED_PID = /\bpid[\s:=#]*(\d{2,7})\b/gi

/** How a reply's job is asked of the host: a script by its name, a process as `#<pid>`. */
export function replyJobNames(reply: string | null): string[] {
  if (!reply) {
    return []
  }
  const scripts = (reply.match(NAMED_SCRIPT) ?? []).filter((name) => SAFE_NAME.test(name))
  const pids = [...reply.matchAll(NAMED_PID)].map((match) => `#${match[1]}`)
  return [...new Set([...pids, ...scripts])].slice(0, MAX_JOB_NAMES)
}

/** `fq_cache.py`, or `PID 4821` for a job the reply gives by process id. */
export function replyJobLabel(name: string): string {
  return name.startsWith('#') ? `PID ${name.slice(1)}` : name
}
