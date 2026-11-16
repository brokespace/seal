import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { LiveSession } from '../../../../../shared/live-sessions/live-session-types'
import { SAMPLE_NOW, sampleLiveSession } from '../live-session.test-fixture'
import { SessionSelectionBarView } from './SessionSelectionBar'
import {
  SidebarSessionsToolbarView,
  type SidebarSessionsToolbarViewProps
} from './SidebarSessionsToolbar'

const WIDTH = 260
// The fixture frame's padding comes out of its width.
const FRAME_PADDING = 32
const GPU_BOX = { hostId: 'gpu-box', label: 'gpu-box', kind: 'remote' as const }
const BUILD_SERVER = { hostId: 'build-server', label: 'build-server', kind: 'remote' as const }

const SESSIONS: LiveSession[] = [
  sampleLiveSession('asking', { title: 'Migrate settings storage', status: 'waiting-input' }),
  sampleLiveSession('working', { title: 'Rebrand app icons', status: 'working' }),
  sampleLiveSession('parked', { title: 'Refactor upload pipeline', status: 'waiting-subagent' }),
  sampleLiveSession('resting', { title: 'Fix flaky sidebar test' }),
  sampleLiveSession('training', { machine: GPU_BOX, title: 'Train tokenizer', status: 'working' }),
  sampleLiveSession('evaluating', { machine: GPU_BOX, title: 'Evaluate checkpoints' }),
  sampleLiveSession('packaging', { machine: BUILD_SERVER, title: 'Package nightly build' }),
  sampleLiveSession('ended', { title: 'Add rate limiting', status: 'done', alive: false })
]

const SCAN_ERRORS = {
  'build-server': 'ssh: connect to host build-server port 22: Connection timed out',
  'staging.internal': 'Permission denied (publickey)'
}

function toolbar(
  props: Partial<SidebarSessionsToolbarViewProps> = {},
  width = WIDTH
): ReturnType<typeof defineFixture> {
  return defineFixture({
    width: width + FRAME_PADDING,
    render: () => (
      <div className="bg-worktree-sidebar text-worktree-sidebar-foreground">
        <SidebarSessionsToolbarView
          loaded
          sessions={SESSIONS}
          hostErrors={{}}
          filters={{ machine: null, status: null }}
          now={SAMPLE_NOW}
          onMachineChange={() => {}}
          onStatusChange={() => {}}
          {...props}
        />
      </div>
    )
  })
}

function opening(trigger: string): (frame: HTMLElement) => void {
  return (frame) => {
    frame
      .querySelector<HTMLButtonElement>(`[${trigger}]`)
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
  }
}

const FILTERED = { machine: 'local', status: 'working' as const }

export const loading = toolbar({ loaded: false, sessions: [] })

export const counts = toolbar()

export const filtered = toolbar({ filters: FILTERED })

export const noMatch = toolbar({ filters: { machine: 'gpu-box', status: 'attention' } })

export const scanError = toolbar({ hostErrors: SCAN_ERRORS })

export const machineMenu = {
  ...toolbar({ hostErrors: SCAN_ERRORS, filters: { machine: 'gpu-box', status: null } }),
  interact: opening('data-session-machine-filter')
}

export const statusMenu = {
  ...toolbar({ filters: { machine: null, status: 'attention' } }),
  interact: opening('data-session-status-filter')
}

export const selecting = toolbar({
  selectionBar: <SessionSelectionBarView pickedSessions={SESSIONS.slice(0, 2)} />
})

export const narrow = toolbar({ hostErrors: SCAN_ERRORS, filters: FILTERED }, 200)

export const narrowLoading = toolbar({ loaded: false, sessions: [] }, 200)
