import React, { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useTranslate } from '@/i18n/use-translate'
import { isPlainObject } from '../../../../../shared/agent-config/agent-config-values'
import type { SettingsFormProps } from './agent-config-settings-form'

const EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'UserPromptSubmit',
  'Notification',
  'Stop',
  'SubagentStop',
  'PreCompact',
  'SessionStart',
  'SessionEnd'
]

type Group = Record<string, unknown> & { hooks: unknown[] }
type HookRow = { event: string; group: number; index: number; matcher: string; command: string }

function groupsOf(value: unknown): Group[] {
  return Array.isArray(value)
    ? value.filter((item): item is Group => isPlainObject(item) && Array.isArray(item.hooks))
    : []
}

function rowsOf(hooks: unknown): HookRow[] {
  if (!isPlainObject(hooks)) {
    return []
  }
  return Object.entries(hooks).flatMap(([event, groups]) =>
    groupsOf(groups).flatMap((group, groupIndex) =>
      group.hooks.map((hook, index) => ({
        event,
        group: groupIndex,
        index,
        matcher: typeof group.matcher === 'string' ? group.matcher : '',
        command:
          isPlainObject(hook) && typeof hook.command === 'string'
            ? hook.command
            : JSON.stringify(hook)
      }))
    )
  )
}

/** Claude Code hooks: a command per event, optionally limited to tools matching a pattern. */
export function AgentConfigHooksField({ value, patch }: SettingsFormProps): React.JSX.Element {
  const t = useTranslate()
  const hooks = isPlainObject(value.hooks) ? value.hooks : {}
  const rows = rowsOf(hooks)
  const [event, setEvent] = useState('PostToolUse')
  const [matcher, setMatcher] = useState('')
  const [command, setCommand] = useState('')

  // Each change rewrites one event's list from what the file holds, so other keys of a group stay.
  const remove = (row: HookRow): void => {
    const groups = groupsOf(hooks[row.event])
      .map((group, at) =>
        at === row.group
          ? { ...group, hooks: group.hooks.filter((_, index) => index !== row.index) }
          : group
      )
      .filter((group) => group.hooks.length > 0)
    patch([
      groups.length === 0
        ? { path: ['hooks', row.event], remove: true }
        : { path: ['hooks', row.event], value: groups }
    ])
  }
  const add = (): void => {
    const hook = { type: 'command', command: command.trim() }
    const groups = groupsOf(hooks[event])
    const wanted = matcher.trim()
    const at = groups.findIndex(
      (group) => (typeof group.matcher === 'string' ? group.matcher : '') === wanted
    )
    const next =
      at === -1
        ? [...groups, { ...(wanted ? { matcher: wanted } : {}), hooks: [hook] }]
        : groups.map((group, index) =>
            index === at ? { ...group, hooks: [...group.hooks, hook] } : group
          )
    patch([{ path: ['hooks', event], value: next }])
    setCommand('')
  }

  return (
    <div className="space-y-1.5">
      {rows.map((row) => (
        <div
          key={`${row.event}:${row.group}:${row.index}`}
          className="flex items-center gap-2"
          data-agent-config-hook={row.event}
        >
          <span className="w-32 shrink-0 truncate text-xs">{row.event}</span>
          <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground">
            {row.matcher || '*'}
          </span>
          <span
            className="min-w-0 flex-1 truncate rounded-md bg-muted/40 px-2 py-1 font-mono text-xs"
            title={row.command}
          >
            {row.command}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('auto.components.agentConfig.pairs.remove', 'Remove {{name}}', {
              name: `${row.event} ${row.command}`
            })}
            onClick={() => remove(row)}
          >
            <X />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Select value={event} onValueChange={setEvent}>
          <SelectTrigger
            className="w-32 shrink-0"
            aria-label={t('auto.components.agentConfig.settings.hookEvent', 'Hook event')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {EVENTS.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={matcher}
          placeholder={t('auto.components.agentConfig.settings.hookMatcher', 'tools (optional)')}
          aria-label={t('auto.components.agentConfig.settings.hookMatcherLabel', 'Tool matcher')}
          variant="code"
          className="h-7 w-24 shrink-0"
          onChange={(change) => setMatcher(change.target.value)}
        />
        <Input
          value={command}
          placeholder={t('auto.components.agentConfig.settings.hookCommand', 'command to run')}
          aria-label={t('auto.components.agentConfig.settings.hookCommandLabel', 'Hook command')}
          variant="code"
          className="h-7 min-w-0 flex-1"
          onChange={(change) => setCommand(change.target.value)}
          onKeyDown={(press) => {
            if (press.key === 'Enter' && command.trim() !== '') {
              press.preventDefault()
              add()
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={command.trim() === ''}
          onClick={add}
        >
          <Plus />
          {t('auto.components.agentConfig.pairs.add', 'Add')}
        </Button>
      </div>
    </div>
  )
}
