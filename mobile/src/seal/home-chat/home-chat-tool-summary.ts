import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  Eraser,
  FilePen,
  FileText,
  Globe,
  ListChecks,
  Megaphone,
  MessageSquare,
  Paperclip,
  Search,
  Server,
  ServerCog,
  Square,
  Terminal,
  Trash2,
  Users,
  type LucideIcon
} from 'lucide-react-native'
import type { HomeChatEntry } from '../../../../src/shared/home-chat/home-chat-types'

export type HomeChatToolEntry = Extract<HomeChatEntry, { kind: 'tool' }>

export const HOME_CHAT_TOOL_ICONS: Partial<Record<string, LucideIcon>> = {
  run_command: Terminal,
  read_file: FileText,
  write_file: FilePen,
  transfer_file: ArrowLeftRight,
  delete_path: Trash2,
  seal_cli: Bot,
  list_machines: Server,
  job_status: Activity,
  job_output: FileText,
  job_kill: Square,
  job_cleanup: Eraser,
  configure_machine: ServerCog,
  attach_file: Paperclip,
  report_progress: Megaphone,
  remember: Brain,
  forget: Eraser,
  load_skill: BookOpen,
  spawn_subagent: Users,
  check_subagent: ListChecks,
  message_subagent: MessageSquare,
  stop_subagent: Square,
  web_search: Search,
  web_fetch: Globe,
  routines: CalendarClock
}

/** `mcp__server__do_thing` reads as "do thing". */
export function homeChatToolLabel(tool: string): string {
  return tool.replace(/^mcp__\w+__/, '').replaceAll('_', ' ')
}

/** One line that says what the call does, in the words of the tool's own arguments; matches the desktop card. */
export function homeChatToolSummary(entry: HomeChatToolEntry): string {
  const input = entry.input
  const str = (key: string): string => {
    const value = input[key]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  }
  switch (entry.tool) {
    case 'run_command':
      return `${input.background === true ? '& ' : '$ '}${str('command')}`
    case 'read_file':
    case 'write_file':
    case 'delete_path':
    case 'attach_file':
      return str('path')
    case 'job_status':
    case 'job_output':
    case 'job_kill':
    case 'job_cleanup':
      return str('job_id')
    case 'configure_machine':
      return str('machine')
    case 'remember':
      return `${str('kind') || 'fact'}: ${str('text')}`
    case 'forget':
      return str('query')
    case 'load_skill':
      return str('name')
    case 'spawn_subagent':
      return str('title')
    case 'check_subagent':
    case 'message_subagent':
    case 'stop_subagent':
      return str('id')
    case 'web_search':
      return str('query')
    case 'web_fetch':
      return str('url')
    case 'routines':
      return [str('action'), str('name') || str('id'), str('schedule')].filter(Boolean).join(' ')
    case 'transfer_file':
      return `${str('from_machine')}:${str('from_path')} → ${str('to_machine')}:${str('to_path')}`
    case 'seal_cli':
      return `seal ${Array.isArray(input.args) ? input.args.join(' ') : ''}`
    case 'list_machines':
      return input.probe_load === true ? 'with load' : ''
    default:
      return JSON.stringify(input)
  }
}
