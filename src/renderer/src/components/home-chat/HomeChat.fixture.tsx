import { defineFixture } from '../../component-fixtures/component-fixture'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import type { HomeChatMemory } from '../../../../shared/home-chat/home-chat-memory-types'
import type {
  HomeChat as HomeChatRecord,
  HomeChatEntry,
  HomeChatMachineOption,
  HomeChatSettings
} from '../../../../shared/home-chat/home-chat-types'
import HomeChat from './HomeChat'

type EntryDraft = HomeChatEntry extends infer E
  ? E extends HomeChatEntry
    ? Omit<E, 'ord'>
    : never
  : never

function inOrder(entries: EntryDraft[]): HomeChatEntry[] {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a draft is an entry minus `ord`, which is added here; a spread loses the union.
  return entries.map((entry, index) => ({ ...entry, ord: index + 1 }) as HomeChatEntry)
}

const machines: HomeChatMachineOption[] = [
  { id: 'local', label: 'This computer', kind: 'local', status: 'online' },
  {
    id: 'machine:build-box',
    label: 'build-box',
    kind: 'remote',
    status: 'online',
    address: 'ci@10.0.0.12'
  },
  { id: 'machine:tower', label: 'tower', kind: 'remote', status: 'offline' }
]

const conversation: HomeChatRecord = {
  id: 'chat-1',
  title: 'Free up space on the build box',
  backend: 'claude-code',
  accountId: null,
  model: null,
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
  context: { usedTokens: 148_200, windowTokens: 200_000, compactions: 1 },
  lastMachine: 'build-box',
  entries: inOrder([
    {
      id: 'c0',
      rev: 1,
      at: 1,
      kind: 'compaction',
      auto: true,
      summary:
        '## Goal\nKeep the build box healthy.\n\n## Done so far\n- Rotated the CI logs on build-box.'
    },
    {
      id: 'u1',
      rev: 1,
      at: 1,
      kind: 'user',
      text: 'The build box is almost out of disk. Find what is big and clean up old build caches.',
      delivery: 'delivered'
    },
    {
      id: 'th1',
      rev: 2,
      at: 2,
      kind: 'thinking',
      text: 'The user named the build box, so use that machine.',
      streaming: false,
      durationMs: 3200
    },
    {
      id: 't1',
      rev: 3,
      at: 3,
      kind: 'tool',
      tool: 'list_machines',
      input: {},
      status: 'ok',
      output: 'local (this computer)\nssh:build-box  connected  linux',
      durationMs: 210
    },
    {
      id: 't2',
      rev: 3,
      at: 4,
      kind: 'tool',
      tool: 'run_command',
      input: { machine: 'ssh:build-box', command: 'du -sh ~/.cache/* | sort -h | tail -3' },
      machine: 'build-box',
      status: 'ok',
      output: '2.1G\t/home/ci/.cache/pip\n9.4G\t/home/ci/.cache/bazel\n31G\t/home/ci/.cache/turbo',
      durationMs: 4100
    },
    {
      id: 'a1',
      rev: 4,
      at: 5,
      kind: 'assistant',
      text: 'Most of the space is the **Turborepo cache** (31 GB) in `~/.cache/turbo`. I will remove it; the next build repopulates it.',
      streaming: false
    },
    {
      id: 't3',
      rev: 1,
      at: 6,
      kind: 'tool',
      tool: 'delete_path',
      input: { machine: 'ssh:build-box', path: '/home/ci/.cache/turbo', recursive: true },
      machine: 'build-box',
      status: 'awaiting-approval',
      approvalReason: 'This deletes /home/ci/.cache/turbo.'
    }
  ])
}

const settings: HomeChatSettings = {
  defaultBackend: 'claude-code',
  openai: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    apiKeyConfigured: false,
    contextWindow: 128_000
  },
  web: { searchProvider: 'duckduckgo', searxngUrl: '', searchApiKeyConfigured: false }
}

const memory: HomeChatMemory = {
  rules: [
    { id: 'r1', text: 'Always push to a feature branch, never to main', at: 1 },
    { id: 'r2', text: 'Clean up temp files you create', at: 1 }
  ],
  facts: [
    { id: 'f1', text: 'tower is the GPU box; repos live in ~/src', at: 1 },
    { id: 'f2', text: 'Brian prefers pnpm over npm', at: 1 }
  ],
  machines: [
    { machine: 'ssh:tower', notes: 'Ubuntu 24.04, user brian, 2x 4090' },
    {
      machine: 'hop:lab-nas',
      notes: 'Backups land in /volume1/backup',
      via: 'ssh:tower',
      host: '10.0.0.7',
      user: 'admin'
    }
  ],
  journal: [{ id: 'j1', text: 'Moved nightly backups to the NAS', at: Date.UTC(2026, 10, 12) }]
}

const SCREENSHOT_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300"><rect width="640" height="300" fill="#f4f4f5"/><rect x="24" y="24" width="592" height="40" rx="6" fill="#e4e4e7"/><text x="40" y="50" font-family="sans-serif" font-size="16" fill="#27272a">localhost:5173 - Seal dashboard</text><rect x="24" y="84" width="280" height="190" rx="8" fill="#ffffff"/><rect x="324" y="84" width="292" height="190" rx="8" fill="#ffffff"/><text x="44" y="120" font-family="sans-serif" font-size="14" fill="#52525b">Build passed</text></svg>'

function fakeHomeChatApi(chats: HomeChatRecord[]): HomeChatApi {
  return {
    list: async () => chats.map(({ entries: _entries, ...summary }) => summary),
    get: async ({ chatId }) => chats.find((chat) => chat.id === chatId) ?? null,
    create: async () => conversation,
    update: async () => conversation,
    delete: async () => {},
    send: async () => {},
    stop: async () => {},
    compact: async () => true,
    listMachines: async () => machines,
    respondApproval: async () => true,
    getSettings: async () => settings,
    updateSettings: async () => settings,
    listAccounts: async () => [
      { backend: 'claude-code', id: null, label: 'System login' },
      { backend: 'codex', id: null, label: 'System login' }
    ],
    getMemory: async () => memory,
    updateMemory: async () => memory,
    readAttachment: async () => ({ mimeType: 'image/svg+xml', base64: btoa(SCREENSHOT_SVG) }),
    revealAttachment: async () => {},
    saveAttachment: async () => true,
    onEvent: () => () => {}
  }
}

const backgroundWork: HomeChatRecord = {
  ...conversation,
  id: 'chat-2',
  title: 'Start the dashboard on tower',
  status: 'idle',
  context: { usedTokens: 21_400, windowTokens: 200_000, compactions: 0 },
  lastMachine: 'tower',
  entries: inOrder([
    {
      id: 'b1',
      rev: 1,
      at: 1,
      kind: 'user',
      text: 'Start the dashboard dev server on tower, tell me when the build is done and show me a screenshot.',
      delivery: 'delivered'
    },
    {
      id: 'b2',
      rev: 1,
      at: 2,
      kind: 'assistant',
      text: 'Starting it on **tower**, where the repo lives. This takes a few minutes; I will report back when it is up.',
      streaming: false
    },
    {
      id: 'b3',
      rev: 2,
      at: 3,
      kind: 'tool',
      tool: 'run_command',
      input: {
        machine: 'ssh:tower',
        command: 'cd ~/src/dashboard && pnpm build && pnpm dev --port 5173',
        timeout_seconds: 30
      },
      machine: 'tower',
      status: 'ok',
      durationMs: 30_400,
      output: 'Still running after 30s, so it continues as background job 3f9a1c2e on tower.'
    },
    {
      id: 'b4',
      rev: 1,
      at: 4,
      kind: 'notice',
      source: 'job',
      text: 'Background job 3f9a1c2e on tower printed "ready in 2.1s".\nLast output:\n✓ built in 94s\nVITE ready in 2.1s\n➜ Local: http://localhost:5173/'
    },
    {
      id: 'b5',
      rev: 2,
      at: 5,
      kind: 'tool',
      tool: 'run_command',
      input: {
        machine: 'ssh:tower',
        command: 'npx playwright screenshot http://localhost:5173 /tmp/seal-dash.png'
      },
      machine: 'tower',
      status: 'ok',
      durationMs: 6200,
      output: 'exit code 0'
    },
    {
      id: 'b6',
      rev: 1,
      at: 6,
      kind: 'attachment',
      attachmentId: 'att1',
      name: 'seal-dash.png',
      mimeType: 'image/png',
      size: 182_331,
      machine: 'tower'
    },
    {
      id: 'b7',
      rev: 1,
      at: 7,
      kind: 'assistant',
      text: 'The build passed and the dashboard is serving on tower at `localhost:5173` (job 3f9a1c2e keeps it running). I removed the screenshot from `/tmp`.',
      streaming: false
    }
  ])
}

export const conversationWithApproval = defineFixture({
  width: 520,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([conversation])
  },
  render: () => <HomeChat className="h-[760px]" />
})

export const empty = defineFixture({
  width: 520,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([])
  },
  render: () => <HomeChat className="h-[420px]" />
})

export const backgroundJobAndAttachment = defineFixture({
  width: 520,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([backgroundWork])
  },
  render: () => <HomeChat className="h-[860px]" />
})

export const memoryEditor = defineFixture({
  width: 720,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([conversation])
  },
  render: () => <HomeChat className="h-[640px]" />,
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('button[aria-label="Memory"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})

export const settingsWithWebSearch = defineFixture({
  width: 520,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([conversation])
  },
  render: () => <HomeChat className="h-[720px]" />,
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('button[aria-label="Assistant settings"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})

export const threadList = defineFixture({
  width: 520,
  setup: () => {
    window.api.homeChat = fakeHomeChatApi([conversation, backgroundWork])
  },
  render: () => <HomeChat className="h-[640px]" />,
  interact: async (frame) => {
    frame.querySelector<HTMLButtonElement>('button[aria-label="Threads"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
})
