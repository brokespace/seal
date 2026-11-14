import { q, seedFile } from './tool-case-support'
import type { Target } from './tool-case-types'

/** Where the stand-in CLI writes what a Seal pane started it with. */
export const FAKE_CLAUDE_LAUNCH_FILE = 'seal-e2e-claude-launch.json'

// Stands in for the Claude CLI: a headless resume appends the turn to the transcript as Claude does.
const FAKE_CLAUDE = `#!/usr/bin/env python3
import datetime, glob, json, os, sys, time, uuid

args = sys.argv[1:]
home = os.path.expanduser('~')

def row(kind, session, message):
    now = datetime.datetime.now(datetime.timezone.utc)
    return json.dumps({
        'parentUuid': None, 'isSidechain': False, 'type': kind, 'message': message,
        'uuid': str(uuid.uuid4()), 'timestamp': now.isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'cwd': os.getcwd(), 'sessionId': session, 'version': '2.1.325', 'userType': 'external',
    }) + '\\n'

if '-p' in args and '--resume' in args:
    session = args[args.index('--resume') + 1]
    text = args[-1]
    path = glob.glob(home + '/.claude/projects/*/' + session + '.jsonl')[0]
    with open(path, 'a') as out:
        out.write(row('user', session, {'role': 'user', 'content': text}))
        out.write(row('assistant', session, {
            'id': 'msg_' + uuid.uuid4().hex, 'type': 'message', 'role': 'assistant', 'model': 'fake',
            'stop_reason': 'end_turn', 'content': [{'type': 'text', 'text': 'fake claude heard: ' + text}],
        }))
else:
    with open(home + '/${FAKE_CLAUDE_LAUNCH_FILE}', 'w') as out:
        json.dump({'args': args, 'cwd': os.getcwd()}, out)
    time.sleep(600)
`

export function installFakeClaude(target: Target): void {
  seedFile(target, `${target.home}/bin/claude`, FAKE_CLAUDE)
  target.sh(`chmod +x ${q(`${target.home}/bin/claude`)}`)
}

function transcriptRow(
  kind: 'user' | 'assistant',
  session: { id: string; cwd: string },
  text: string,
  at: Date
): string {
  return `${JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: kind,
    message:
      kind === 'user'
        ? { role: 'user', content: text }
        : {
            id: `msg_${at.getTime()}`,
            type: 'message',
            role: 'assistant',
            model: 'fake',
            stop_reason: 'end_turn',
            content: [{ type: 'text', text }]
          },
    uuid: `00000000-0000-4000-8000-${String(at.getTime()).padStart(12, '0')}`,
    timestamp: at.toISOString(),
    cwd: session.cwd,
    sessionId: session.id,
    version: '2.1.325',
    userType: 'external'
  })}\n`
}

/** A Claude conversation that ended a while ago, where Claude keeps its transcripts. */
export function seedClosedClaudeSession(
  target: Target,
  session: { id: string; cwd: string; turns: readonly { ask: string; answer: string }[] }
): string {
  const endedAt = Date.now() - 10 * 60_000
  const rows = session.turns.flatMap((turn, index) => {
    const at = endedAt - (session.turns.length - index) * 60_000
    return [
      transcriptRow('user', session, turn.ask, new Date(at)),
      transcriptRow('assistant', session, turn.answer, new Date(at + 1_000))
    ]
  })
  const path = `${target.home}/.claude/projects/${session.cwd.replace(/[^A-Za-z0-9]/g, '-')}/${session.id}.jsonl`
  seedFile(target, path, rows.join(''))
  target.sh(`mkdir -p ${q(session.cwd)} && touch -d '10 minutes ago' ${q(path)}`)
  return path
}

/** A process `ps` shows as the Claude CLI, as one started in a terminal outside Seal would be. */
export function startFakeClaudeProcess(target: Target, cwd: string, args = ''): number {
  const name = args ? `claude ${args}` : 'claude'
  const pid = target
    .sh(
      `mkdir -p ${q(cwd)} && cd ${q(cwd)} && { nohup perl -e '$0 = shift; sleep 600' ${q(name)} >/dev/null 2>&1 </dev/null & echo $!; }`
    )
    .toString()
    .trim()
  return Number(pid)
}

export function processRuns(target: Target, pid: number): boolean {
  return target.sh(`kill -0 ${pid} 2>/dev/null && echo yes || echo no`).toString().trim() === 'yes'
}

export function stopProcess(target: Target, pid: number): void {
  target.sh(`kill -KILL ${pid} 2>/dev/null || true`)
}
