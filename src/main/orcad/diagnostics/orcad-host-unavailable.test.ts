import { describe, expect, it } from 'vitest'
import { isOrcadHostUnavailableRecheckedOnConnect } from './orcad-host-unavailable'

describe('which unavailable reasons are rechecked on every connect', () => {
  it('rechecks missing server files, which a rebuild of the same version fixes', () => {
    expect(isOrcadHostUnavailableRecheckedOnConnect('artifacts_unavailable')).toBe(true)
    expect(isOrcadHostUnavailableRecheckedOnConnect('runtime_noexec')).toBe(true)
  })

  it('remembers a host the server cannot run on', () => {
    expect(isOrcadHostUnavailableRecheckedOnConnect('unsupported_host')).toBe(false)
  })
})
