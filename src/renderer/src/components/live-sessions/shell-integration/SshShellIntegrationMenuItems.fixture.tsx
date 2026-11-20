import { defineFixture } from '../../../component-fixtures/component-fixture'
import { SshTargetCard } from '../../settings/ssh/targets/SshTargetCard'

const noop = () => {}

export const sshCardMenu = defineFixture({
  width: 640,
  render: () => (
    <div className="h-[380px] p-4">
      <SshTargetCard
        target={{
          id: 'ssh-build',
          label: 'build-box',
          host: 'build.internal',
          port: 22,
          username: 'brian'
        }}
        state={{
          targetId: 'ssh-build',
          status: 'connected',
          error: null,
          reconnectAttempt: 0,
          remotePlatform: 'linux'
        }}
        testing={false}
        onConnect={noop}
        onDisconnect={noop}
        onTest={noop}
        onEdit={noop}
        onRemove={noop}
      />
    </div>
  ),
  interact: (frame) => {
    const trigger = frame.querySelector<HTMLButtonElement>('button[aria-label^="More actions"]')
    trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  }
})
