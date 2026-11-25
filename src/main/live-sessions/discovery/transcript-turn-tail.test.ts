import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { localHost } from '../hosts/live-session-hosts'
import { HostSessionScanner, LOCAL_SCAN_LIMITS } from './host-session-scanner'
import { aiVaultTranscriptFiles } from './local-transcript-files'
import { FIXTURES } from './session-scan.test-fixture'

const SESSION_ID = '34e3c779-8064-489d-9402-8cda9560534a'

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'seal-tail-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', '')
  vi.stubEnv('CODEX_HOME', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(home, { recursive: true, force: true })
})

const viaAiVault = () =>
  aiVaultTranscriptFiles(async () => ({
    claudeProjectsDir: join(home, '.claude/projects'),
    codexSessionsDir: join(home, '.codex/sessions')
  }))

describe.skipIf(process.platform === 'win32')('the end of a transcript a scan reads', () => {
  it.each([
    ['the script', () => undefined],
    ['AI Vault discovery', viaAiVault]
  ])(
    'still lists a background launch through %s when Claude Code logged its next request after it',
    async (_, source) => {
      const recorded = (
        await readFile(join(FIXTURES, 'live-claude-background-command-running.jsonl'), 'utf8')
      )
        // No agent on the machine running the test may pair with it.
        .replaceAll('/tmp/cc-home/w/checkin', join(home, 'shop'))
        .trimEnd()
        .split('\n')
      // What Claude Code 2.1.325 wrote ahead of each of the turn's two requests: 60 KB of prompt.
      const requestLog = [
        JSON.stringify({
          parentUuid: null,
          isSidechain: false,
          attachment: { type: 'prompt_snapshot', systemPrompt: ['# Harness\n'.repeat(6_000)] }
        }),
        JSON.stringify({
          type: 'api-request',
          sessionId: SESSION_ID,
          params: { model: 'claude-opus-5-5', tools: 'Bash '.repeat(2_000) }
        })
      ]
      const dir = join(home, '.claude/projects/-srv-shop')
      const file = join(dir, `${SESSION_ID}.jsonl`)
      await mkdir(dir, { recursive: true })
      await writeFile(
        file,
        `${[...recorded.slice(0, 3), ...requestLog, ...recorded.slice(3, 8), ...requestLog, ...recorded.slice(8)].join('\n')}\n`
      )

      const scanner = new HostSessionScanner(localHost('test', source()), LOCAL_SCAN_LIMITS)
      const { sessions } = await scanner.scan((await stat(file)).mtimeMs)

      const session = sessions.find((s) => s.transcriptPath === file)
      expect({ status: session?.status, detail: session?.statusDetail }).toEqual({
        status: 'your-turn',
        detail: '1 background task still running'
      })
    }
  )
})
