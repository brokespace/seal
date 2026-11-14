import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { SshTarget } from '../../../../../shared/ssh-types'
import { SshPane } from './SshPane'

const targets: SshTarget[] = [
  {
    id: 'build',
    label: 'build-box',
    configHost: 'build-box',
    host: 'build.internal',
    port: 22,
    username: 'brian',
    source: 'ssh-config',
    identityFile: '/Users/brian/.ssh/id_ed25519'
  },
  {
    id: 'colima',
    label: 'colima',
    configHost: 'colima',
    host: '127.0.0.1',
    port: 50022,
    username: 'brian',
    source: 'ssh-config',
    identityFile: '/Users/brian/.colima/_lima/_config/user'
  },
  {
    id: 'orb',
    label: 'orb',
    configHost: 'orb',
    host: 'localhost',
    port: 32222,
    username: 'default',
    source: 'ssh-config',
    identityFile: '/Users/brian/.orbstack/ssh/id_ed25519'
  },
  { id: 'pi', label: 'raspberry-pi', host: 'pi.local', port: 22, username: 'pi', source: 'manual' }
]

export const autoImportedHidden = defineFixture({
  width: 760,
  setup: () => {
    window.api.ssh = {
      ...window.api.ssh,
      listTargets: async () => targets,
      importConfig: async () => ({ targets: [], repoReadoptions: [] }),
      listConfigHosts: async () => ({
        hosts: [],
        totalHostCount: 0,
        newHostCount: 0,
        matchCount: 0,
        hasMore: false
      })
    }
  },
  render: () => (
    <div className="h-[480px] px-4">
      <SshPane />
    </div>
  )
})
