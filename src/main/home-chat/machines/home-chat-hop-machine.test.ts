import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { hopSshCommand } from './home-chat-hop-machine'

const run = promisify(execFile)

describe.skipIf(process.platform === 'win32')('hopSshCommand', () => {
  it('builds an ssh call on the jump machine that runs the script verbatim on the target', async () => {
    const script = `printf '%s\\n' "it's \\$HOME"; echo "a b"`
    const command = hopSshCommand(
      {
        machine: 'hop:lab',
        notes: '',
        via: 'ssh:tower',
        host: '10.0.0.7',
        user: 'brian',
        port: 2222
      },
      script
    )
    expect(command.startsWith("'ssh' ")).toBe(true)
    expect(command).toContain("'-p' '2222' 'brian@10.0.0.7' '--' ")

    // A stand-in ssh runs the remote argument through sh, as sshd would.
    const stub = `ssh() { while [ "$1" != "--" ]; do shift; done; shift; sh -c "$1"; }; ${command.replace(/^'ssh'/, 'ssh')}`
    const { stdout } = await run('sh', ['-c', stub], { env: { ...process.env, HOME: '/home/x' } })
    expect(stdout).toBe("it's $HOME\na b\n")
  })
})
