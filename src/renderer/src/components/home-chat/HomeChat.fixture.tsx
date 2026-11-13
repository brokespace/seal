import { defineFixture } from '../../component-fixtures/component-fixture'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import type { HomeChat as HomeChatRecord } from '../../../../shared/home-chat/home-chat-types'
import HomeChat from './HomeChat'

const conversation: HomeChatRecord = {
  id: 'chat-1',
  title: 'Free up space on the build box',
  backend: 'claude-code',
  accountId: null,
  model: null,
  status: 'running',
  createdAt: 1,
  updatedAt: 2,
  entries: [
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
  ]
}

function fakeHomeChatApi(chats: HomeChatRecord[]): HomeChatApi {
  const { entries: _entries, ...summary } = conversation
  return {
    list: async () => chats.map(() => summary),
    get: async ({ chatId }) => chats.find((chat) => chat.id === chatId) ?? null,
    create: async () => conversation,
    update: async () => summary,
    delete: async () => {},
    send: async () => {},
    stop: async () => {},
    respondApproval: async () => true,
    getSettings: async () => ({
      defaultBackend: 'claude-code',
      openai: { baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKeyConfigured: false }
    }),
    updateSettings: async () => ({
      defaultBackend: 'claude-code',
      openai: { baseUrl: 'https://openrouter.ai/api/v1', model: '', apiKeyConfigured: false }
    }),
    listAccounts: async () => [{ id: null, label: 'Default login' }],
    onEvent: () => () => {}
  }
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
