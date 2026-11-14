import { describe, expect, it } from 'vitest'
import { resumeCommandLine } from './seal-session-terminal'

describe('resumeCommandLine', () => {
  it('resumes Claude through the session’s own pointer, quoted for the shell', () => {
    expect(
      resumeCommandLine({
        provider: 'claude',
        providerSessionId: '4f1c-9a',
        platform: 'linux',
        claudePointer: "/data/it's/session-1"
      })
    ).toBe("ORCA_CLAUDE_PROFILE_POINTER='/data/it'\\''s/session-1' claude --resume 4f1c-9a")
  })

  it('sets CODEX_HOME the PowerShell way on Windows', () => {
    expect(
      resumeCommandLine({
        provider: 'codex',
        providerSessionId: 'abc',
        platform: 'win32',
        codexHome: "C:\\Seal\\o'k"
      })
    ).toBe("$env:CODEX_HOME='C:\\Seal\\o''k'; codex resume abc")
  })

  it('refuses a session id that could inject shell text', () => {
    expect(() =>
      resumeCommandLine({ provider: 'claude', providerSessionId: 'x; rm -rf ~', platform: 'linux' })
    ).toThrow()
  })
})
