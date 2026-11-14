import { describe, expect, it } from 'vitest'
import '../../runtime/rpc/server/runtime-rpc-pairing-types'
import './serve-mode-argv'
import { getServeOptions } from './serve-options'
import { resolveServePinnedBindHost } from './serve-pinned-bind-host'

describe('Electron serve listener pin', () => {
  it('accepts --mobile-pairing on any bind: Relay pairs a loopback listener', () => {
    for (const bind of [[], ['--serve-bind', '127.0.0.1'], ['--serve-bind', '0.0.0.0']]) {
      expect(
        getServeOptions(['/AppRun', '--serve', ...bind, '--serve-mobile-pairing']).mobilePairing
      ).toBe(true)
    }
  })

  it('listens on loopback unless the operator names an address', () => {
    expect(
      resolveServePinnedBindHost({
        orcadSidecar: false,
        serveOptions: getServeOptions(['/AppRun', '--serve'])
      })
    ).toBe('127.0.0.1')
    expect(
      resolveServePinnedBindHost({
        orcadSidecar: false,
        serveOptions: getServeOptions(['/AppRun', '--serve', '--serve-bind', '0.0.0.0'])
      })
    ).toBe('0.0.0.0')
    // The desktop app keeps its own choice: loopback until a LAN pairing widens it.
    expect(resolveServePinnedBindHost({ orcadSidecar: false, serveOptions: null })).toBeUndefined()
  })
})
