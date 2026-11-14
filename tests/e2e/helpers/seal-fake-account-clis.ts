import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type FakeClaudeLogin = {
  email: string
  organizationUuid: string
  organizationName: string
  /** The code the sign-in page would show; the fake rejects any other. */
  code: string
}

export type FakeCodexLogin = {
  email: string
  accountId: string
  plan: 'plus' | 'pro' | 'team'
}

export type FakeCliProcess = { cli: 'claude' | 'codex'; args: string[]; pid: number }

export type SealFakeAccountClis = {
  /** Prepend to PATH so the app runs these instead of real CLIs. */
  binDir: string
  env: Record<string, string>
  /** The account the next `claude auth login` signs in to once its code is pasted. */
  nextClaudeLogin: (login: FakeClaudeLogin) => void
  /** Approves the `codex login` that is waiting on its browser or device code. */
  approveCodexLogin: (login: FakeCodexLogin) => void
  /** Every fake CLI process started so far, running or not. */
  processes: () => FakeCliProcess[]
  dispose: () => void
}

export const FAKE_CLAUDE_SIGN_IN_LINK =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=seal-e2e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&state=SEAL_E2E'
export const FAKE_CODEX_DEVICE_CODE = 'SEAL-E2E42'

export function fakeClaudeAccessToken(email: string): string {
  return `claude-token-${email}`
}

export function fakeCodexAccessToken(email: string): string {
  return `codex-token-${email}`
}

function jwt(payload: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part(payload)}.signature`
}

/** What `codex login` leaves in CODEX_HOME/auth.json for a ChatGPT account. */
export function fakeCodexAuthJson(login: FakeCodexLogin): string {
  return JSON.stringify({
    OPENAI_API_KEY: null,
    tokens: {
      id_token: jwt({
        email: login.email,
        exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        'https://api.openai.com/auth': {
          chatgpt_account_id: login.accountId,
          chatgpt_plan_type: login.plan
        }
      }),
      access_token: fakeCodexAccessToken(login.email),
      refresh_token: `codex-refresh-${login.email}-${Date.now()}`,
      account_id: login.accountId
    },
    last_refresh: new Date().toISOString()
  })
}

/** Signs a machine's own `claude` CLI in, as `claude auth login` in a plain terminal would. */
export function writeFakeClaudeSystemLogin(
  home: string,
  login: Omit<FakeClaudeLogin, 'code'>
): void {
  mkdirSync(path.join(home, '.claude'), { recursive: true })
  writeFileSync(
    path.join(home, '.claude.json'),
    JSON.stringify({
      oauthAccount: {
        emailAddress: login.email,
        organizationUuid: login.organizationUuid,
        organizationName: login.organizationName
      }
    })
  )
  writeFileSync(
    path.join(home, '.claude', '.credentials.json'),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: fakeClaudeAccessToken(login.email),
        refreshToken: `claude-refresh-${login.email}`,
        expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max'
      }
    })
  )
}

/** Signs a machine's own `codex` CLI in, as `codex login` in a plain terminal would. */
export function writeFakeCodexSystemLogin(home: string, login: FakeCodexLogin): void {
  mkdirSync(path.join(home, '.codex'), { recursive: true })
  writeFileSync(path.join(home, '.codex', 'auth.json'), fakeCodexAuthJson(login))
}

// One script serves both CLIs. It records its pid, and its sign-in runs with a helper child that
// ignores SIGTERM, so a login the app merely asked to stop would show up as a surviving process.
const FAKE_CLI = String.raw`#!/usr/bin/env node
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const cli = path.basename(process.argv[1])
const args = process.argv.slice(2)
const control = process.env.SEAL_FAKE_CLI_CONTROL
const record = (pid) =>
  fs.appendFileSync(path.join(control, 'processes.jsonl'), JSON.stringify({ cli, args, pid }) + '\n')
record(process.pid)

const take = (name) => {
  const file = path.join(control, name)
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.rmSync(file, { force: true })
    return value
  } catch {
    return null
  }
}
const stubbornHelper = () => {
  const helper = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 60000)"],
    { stdio: 'ignore' }
  )
  record(helper.pid)
  return helper
}
const finish = (helper, code) => {
  helper.kill('SIGKILL')
  process.exit(code)
}
const idle = (banner) => {
  process.stdout.write(banner + '\n')
  process.stdin.resume()
  setInterval(() => {}, 60000)
}

if (args.includes('--version')) {
  process.stdout.write(cli === 'claude' ? '2.1.306 (Claude Code)\n' : 'codex-cli 0.130.0\n')
  process.exit(0)
}

if (cli === 'claude') {
  const configDir = process.env.CLAUDE_CONFIG_DIR
  const dir = configDir || path.join(os.homedir(), '.claude')
  const stateFile = configDir ? path.join(configDir, '.claude.json') : path.join(os.homedir(), '.claude.json')
  if (args[0] === 'auth' && args[1] === 'login') {
    process.on('SIGTERM', () => {})
    const helper = stubbornHelper()
    process.stdout.write(
      "Opening browser to sign in\nIf the browser didn't open, visit: ${FAKE_CLAUDE_SIGN_IN_LINK}\nPaste code here if prompted > "
    )
    process.stdin.once('data', (chunk) => {
      const login = take('claude-login.json')
      if (!login || chunk.toString().trim() !== login.code) {
        process.stderr.write('Invalid code\n')
        finish(helper, 1)
      }
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(stateFile, JSON.stringify({ oauthAccount: login.oauthAccount }))
      fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify(login.credentials))
      process.stdout.write('Login successful.\n')
      finish(helper, 0)
    })
  } else if (args[0] === 'auth' && args[1] === 'logout') {
    fs.rmSync(path.join(dir, '.credentials.json'), { force: true })
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
      delete state.oauthAccount
      fs.writeFileSync(stateFile, JSON.stringify(state))
    } catch {}
    process.stdout.write('Successfully logged out from your Anthropic account.\n')
    process.exit(0)
  } else {
    let email = 'not signed in'
    try {
      email = JSON.parse(fs.readFileSync(stateFile, 'utf8')).oauthAccount.emailAddress
    } catch {}
    idle('Claude Code (stand-in) signed in as ' + email)
  }
} else {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const authFile = path.join(home, 'auth.json')
  if (args[0] === 'login' && args[1] === 'status') {
    process.exit(fs.existsSync(authFile) ? 0 : 1)
  } else if (args[0] === 'login') {
    process.on('SIGTERM', () => {})
    const helper = stubbornHelper()
    if (args.includes('--device-auth')) {
      process.stdout.write(
        'Follow these steps to sign in with ChatGPT using device code authorization:\n\n' +
          '1. Open this link in your browser and sign in to your account\n   https://auth.openai.com/codex/device\n\n' +
          '2. Enter this one-time code (expires in 15 minutes)\n   ${FAKE_CODEX_DEVICE_CODE}\n\n'
      )
    } else {
      process.stderr.write(
        'Starting local login server on http://localhost:1455.\nIf your browser did not open, navigate to this URL to authenticate:\n\n' +
          'https://auth.openai.com/oauth/authorize?response_type=code&client_id=seal-e2e&state=SEAL_E2E\n\n'
      )
    }
    const poll = setInterval(() => {
      const login = take('codex-login.json')
      if (!login) {
        return
      }
      clearInterval(poll)
      fs.mkdirSync(home, { recursive: true })
      fs.writeFileSync(authFile, login.authJson)
      process.stderr.write('Successfully logged in\n')
      finish(helper, 0)
    }, 100)
  } else if (args[0] === 'logout') {
    fs.rmSync(authFile, { force: true })
    process.stderr.write('Successfully logged out\n')
    process.exit(0)
  } else if (args.includes('app-server') || args.includes('exec')) {
    // Seal's short-lived Codex probes; this stand-in serves no RPC.
    process.exit(1)
  } else {
    idle('Codex (stand-in)')
  }
}
`

/** Writes whole files only, so a fake CLI polling for one never reads half of it. */
function writeControlFile(controlDir: string, name: string, value: unknown): void {
  const temporary = path.join(controlDir, `${name}.tmp`)
  writeFileSync(temporary, JSON.stringify(value))
  renameSync(temporary, path.join(controlDir, name))
}

export function createSealFakeAccountClis(): SealFakeAccountClis {
  const root = mkdtempSync(path.join(os.tmpdir(), 'seal-e2e-fake-clis-'))
  const binDir = path.join(root, 'bin')
  const controlDir = path.join(root, 'control')
  mkdirSync(binDir)
  mkdirSync(controlDir)
  for (const cli of ['claude', 'codex']) {
    writeFileSync(path.join(binDir, cli), FAKE_CLI)
    chmodSync(path.join(binDir, cli), 0o755)
  }
  return {
    binDir,
    env: {
      PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
      SEAL_FAKE_CLI_CONTROL: controlDir
    },
    nextClaudeLogin: (login) =>
      writeControlFile(controlDir, 'claude-login.json', {
        code: login.code,
        oauthAccount: {
          emailAddress: login.email,
          organizationUuid: login.organizationUuid,
          organizationName: login.organizationName
        },
        credentials: {
          claudeAiOauth: {
            accessToken: fakeClaudeAccessToken(login.email),
            refreshToken: `claude-refresh-${login.email}-${Date.now()}`,
            expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
            scopes: ['user:inference', 'user:profile'],
            subscriptionType: 'max'
          }
        }
      }),
    approveCodexLogin: (login) =>
      writeControlFile(controlDir, 'codex-login.json', { authJson: fakeCodexAuthJson(login) }),
    processes: () => {
      try {
        return readFileSync(path.join(controlDir, 'processes.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line): FakeCliProcess => JSON.parse(line))
      } catch {
        return []
      }
    },
    dispose: () => rmSync(root, { recursive: true, force: true })
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}
