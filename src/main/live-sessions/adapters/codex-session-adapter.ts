import type { AgentSessionAdapter } from '../../../shared/live-sessions/adapters/agent-session-adapter'
import { headlessResumeCommand } from '../delivery/headless-resume-command'
import { processProvider } from '../discovery/agent-processes'

/** What only the main process knows about Codex: how its sessions are found outside Seal. */
export const CODEX_SESSION_DISCOVERY: NonNullable<AgentSessionAdapter['discovery']> = {
  processMatch: (argv) => processProvider(argv.join(' ')) === 'codex',
  transcripts: {
    homeEnv: 'CODEX_HOME',
    defaultHome: '.codex',
    transcriptsDir: 'sessions',
    filePattern: 'rollout-*.jsonl'
  },
  resumeCommand: (session, text) =>
    headlessResumeCommand(session, text, {
      binary: 'codex',
      run: (id) => `codex exec --skip-git-repo-check resume ${id} "$T"`
    })
}
