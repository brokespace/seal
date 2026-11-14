import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { LiveSessionMachine } from '../../../shared/live-sessions/live-session-types'
import { assembleHostSessions, type SummarizedTranscript } from './session-assembly'
import { processProvider } from './agent-processes'
import { summarizeClaudeTranscript } from './transcript-summary'
import type { DiscoveredProcess } from './discovery-output'

const machine: LiveSessionMachine = { hostId: 'local', label: 'mbp', kind: 'local' }
const NOW = Date.parse('2026-11-13T21:00:00Z')

function recorded(file: string, path: string, ageMs: number): SummarizedTranscript {
  const text = readFileSync(join(__dirname, '../transcripts/__fixtures__', file), 'utf8')
  return {
    path,
    size: text.length,
    mtimeMs: NOW - ageMs,
    summary: summarizeClaudeTranscript({ path, head: text, tail: text, tailIsWholeFile: true })
  }
}

function claudeFile(path: string, lines: object[], ageMs: number): SummarizedTranscript {
  const text = lines.map((line) => JSON.stringify(line)).join('\n')
  return {
    path,
    size: text.length,
    mtimeMs: NOW - ageMs,
    summary: summarizeClaudeTranscript({ path, head: text, tail: text, tailIsWholeFile: true })
  }
}

const proc = (pid: number, args: string, cwd: string): DiscoveredProcess => ({
  pid,
  ppid: 1,
  tty: null,
  args,
  cwd
})

function assemble(processes: DiscoveredProcess[], transcripts: SummarizedTranscript[]) {
  return assembleHostSessions({
    machine,
    output: { processes, panes: [], hookStates: [], hostNowMs: NOW },
    transcripts,
    nowMs: NOW
  }).map((s) => ({ id: s.providerSessionId, alive: s.alive, path: s.transcriptPath }))
}

const turn = (uuid: string, parentUuid: string | null, text: string) => ({
  type: 'user',
  uuid,
  parentUuid,
  cwd: '/w',
  timestamp: '2026-11-13T20:00:00Z',
  message: { role: 'user', content: text }
})

describe('one card per real conversation', () => {
  it("leaves out Seal's own Home chat backend, process and transcript", () => {
    const homeChat = '/Users/b/Library/Application Support/Seal/home-chat/workspace'
    expect(
      assemble(
        [
          proc(
            700,
            'claude --output-format stream-json --verbose --input-format stream-json --resume 41532093-df01-43f6-9790-bab8fff5a196',
            homeChat
          )
        ],
        [
          recorded(
            'claude-2.1.325-seal-home-chat-preamble.jsonl',
            '/Users/b/.claude/projects/home-chat/41532093-df01-43f6-9790-bab8fff5a196.jsonl',
            10_000
          )
        ]
      )
    ).toEqual([])
  })

  it('keeps a terminal session listed after Seal resumed it headless', () => {
    const resumed = claudeFile(
      '/p/eeeeeeee-0000-4000-8000-000000000005.jsonl',
      [
        { ...turn('e1', null, 'Write the migration'), entrypoint: 'cli' },
        { ...turn('e2', 'e1', 'Also add a rollback'), entrypoint: 'sdk-cli' }
      ],
      600_000
    )
    expect(assemble([], [resumed]).map((s) => s.id)).toEqual([
      'eeeeeeee-0000-4000-8000-000000000005'
    ])
  })

  it('shows a session copied into a second account once, from its newest copy', () => {
    const name = 'dddddddd-0000-4000-8000-000000000004.jsonl'
    const lines = [turn('d1', null, 'Rotate the keys')]
    expect(
      assemble(
        [],
        [
          claudeFile(`/Users/b/.claude/projects/-w/${name}`, lines, 3_600_000),
          claudeFile(`/Users/b/.seal/accounts/work/projects/-w/${name}`, lines, 300_000)
        ]
      )
    ).toEqual([
      {
        id: 'dddddddd-0000-4000-8000-000000000004',
        alive: false,
        path: `/Users/b/.seal/accounts/work/projects/-w/${name}`
      }
    ])
  })

  it('folds a session forked after an error into one card, the fork', () => {
    expect(
      assemble(
        [],
        [
          recorded(
            'claude-2.1.325-error-then-continue.jsonl',
            '/p/e503cd0b-d59c-4221-a949-3c685cf99554.jsonl',
            120_000
          ),
          recorded(
            'claude-2.1.325-fork-of-errored.jsonl',
            '/p/7f01a62c-a158-4451-a43b-a2e253ed713e.jsonl',
            60_000
          )
        ]
      ).map((s) => s.id)
    ).toEqual(['7f01a62c-a158-4451-a43b-a2e253ed713e'])
  })

  it('pairs a running agent with the transcript it is writing even outside its folder', () => {
    const live = claudeFile(
      '/p/cccccccc-0000-4000-8000-000000000003.jsonl',
      [turn('c1', null, 'Deploy it')],
      5_000
    )
    expect(assemble([proc(812, 'claude', '/w/sub')], [live])).toEqual([
      { id: 'cccccccc-0000-4000-8000-000000000003', alive: true, path: live.path }
    ])
  })
})

describe('agent process detection', () => {
  it('counts only real claude and codex sessions', () => {
    const cases = {
      claude: 'claude',
      'claude --continue': 'claude',
      'node /usr/lib/node_modules/@openai/codex/bin/codex.js resume': 'codex',
      'claude -p summarize': null,
      'claude --output-format stream-json --input-format stream-json': null,
      'codex exec fix it': null,
      'colima start --cpu 4': null,
      'node /opt/claude-monitor/index.js': null,
      'node /srv/codex-proxy.js': null
    }
    expect(
      Object.fromEntries(Object.keys(cases).map((args) => [args, processProvider(args)]))
    ).toEqual(cases)
  })
})
