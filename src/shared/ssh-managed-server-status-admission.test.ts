import { describe, expect, it } from 'vitest'
import { admitSshManagedServerStatus } from './ssh-managed-server-status-admission'

describe('admitSshManagedServerStatus', () => {
  it('keeps the cause behind an unavailable server, such as where its files were looked for', () => {
    expect(
      admitSshManagedServerStatus({
        kind: 'relay',
        reason: 'orcad_unavailable',
        detail: 'artifacts_unavailable',
        cause: 'looked in /app/resources/orcad-template'
      })
    ).toEqual({
      managedServer: {
        kind: 'relay',
        reason: 'orcad_unavailable',
        detail: 'artifacts_unavailable',
        cause: 'looked in /app/resources/orcad-template'
      }
    })
  })

  it('drops a cause that is not text', () => {
    expect(
      admitSshManagedServerStatus({ kind: 'relay', reason: 'orcad_unavailable', cause: 7 })
    ).toEqual({ managedServer: { kind: 'relay', reason: 'orcad_unavailable' } })
  })
})
