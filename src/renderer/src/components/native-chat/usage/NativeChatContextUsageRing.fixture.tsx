import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { defineFixture, type ComponentFixture } from '../../../component-fixtures/component-fixture'
import { unmeasuredContextUsage } from '../../../../../shared/native-chat/native-chat-context-usage-state'
import { summarizeContextUsage } from '../../../../../shared/native-chat/native-chat-context-usage-summary'
import { NativeChatComposerToolbar } from '../composer/controls/NativeChatComposerToolbar'
import { NativeChatContextUsageRing } from './NativeChatContextUsageRing'
import type { NativeChatContextUsageRingInput } from './native-chat-context-usage-ring-input'

const usage = summarizeContextUsage({
  usedTokens: 607_700,
  windowTokens: 1_000_000,
  percentage: 61,
  estimated: false,
  categories: [
    { name: 'System prompt', tokens: 4_100 },
    { name: 'System tools', tokens: 8_900 },
    { name: 'MCP tools (deferred)', tokens: 542_000, deferred: true },
    { name: 'System tools (deferred)', tokens: 17_000, deferred: true },
    { name: 'Memory files', tokens: 5_700 },
    { name: 'Messages', tokens: 589_000 },
    { name: 'Free space', tokens: 359_300 },
    { name: 'Autocompact buffer', tokens: 33_000 }
  ]
})

const MINUTE_MS = 60_000
const WINDOW_TOKENS = 200_000

function sessionUsage(
  usedTokens: number,
  extra: Partial<NativeChatContextUsageRingInput> = {}
): NativeChatContextUsageRingInput {
  return {
    ...summarizeContextUsage({
      usedTokens,
      windowTokens: WINDOW_TOKENS,
      percentage: Math.round((usedTokens / WINDOW_TOKENS) * 100),
      estimated: false,
      categories: [
        { name: 'Messages', tokens: usedTokens - 21_000 },
        { name: 'System tools', tokens: 12_000 },
        { name: 'Memory files', tokens: 5_000 },
        { name: 'System prompt', tokens: 4_000 }
      ]
    }),
    autoCompactAtTokens: 160_000,
    model: 'claude-sonnet-4-5',
    compactions: 2,
    lastCompactedAt: Date.now() - 14 * MINUTE_MS,
    onCompact: () => {},
    ...extra
  }
}

function ringFixture(ringUsage: NativeChatContextUsageRingInput): ComponentFixture {
  return defineFixture({
    width: 360,
    render: () => (
      <div className="flex h-96 items-end justify-end bg-background p-4">
        <NativeChatContextUsageRing usage={ringUsage} />
      </div>
    ),
    interact: (frame) => {
      frame.querySelector<HTMLButtonElement>('button[data-native-chat-context-usage]')?.click()
    }
  })
}

export const deferredTools = ringFixture(usage)

export const normal = ringFixture(sessionUsage(84_000))

export const near = ringFixture(sessionUsage(132_000))

export const critical = ringFixture(sessionUsage(156_000))

export const compacting = ringFixture(sessionUsage(156_000, { compacting: true }))

export const compacted = ringFixture(
  sessionUsage(31_000, { compactions: 3, lastCompactedAt: Date.now() - 20_000 })
)

export const unknown = ringFixture(unmeasuredContextUsage())

export const estimated = ringFixture({
  ...summarizeContextUsage({
    usedTokens: 84_000,
    windowTokens: WINDOW_TOKENS,
    percentage: 42,
    estimated: true,
    categories: []
  }),
  model: 'gpt-5.1-codex'
})

/** A toolbar too narrow for the words: they give way and the ring stays beside Send. */
export const nearInNarrowToolbar = defineFixture({
  width: 140,
  render: () => (
    <div className="bg-background p-4">
      <NativeChatComposerToolbar
        left={[]}
        right={[
          { id: 'context', content: <NativeChatContextUsageRing usage={sessionUsage(132_000)} /> }
        ]}
        primary={
          <Button type="button" size="icon-sm" aria-label="Send">
            <ArrowUp className="size-4" />
          </Button>
        }
      />
    </div>
  )
})
