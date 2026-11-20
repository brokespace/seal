import {
  Activity,
  AppWindow,
  ArrowLeftRight,
  BookOpen,
  Bot,
  Brain,
  CalendarClock,
  Eraser,
  FilePen,
  FileText,
  Gauge,
  Globe,
  Library,
  ListChecks,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Paperclip,
  Play,
  Search,
  Server,
  ServerCog,
  Square,
  Terminal,
  Trash2,
  UserCog,
  Users,
  Wrench,
  type LucideIcon
} from 'lucide-react'

export const HOME_CHAT_FALLBACK_TOOL_ICON = Wrench

export const HOME_CHAT_TOOL_ICONS: Record<string, LucideIcon> = {
  run_command: Terminal,
  codex_shell: Terminal,
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
  list_skills: Library,
  load_skill: BookOpen,
  spawn_subagent: Users,
  check_subagent: ListChecks,
  message_subagent: MessageSquare,
  stop_subagent: Square,
  web_search: Search,
  web_fetch: Globe,
  routines: CalendarClock,
  list_sessions: MessagesSquare,
  read_session: FileText,
  message_session: MessageSquare,
  take_over_session: Bot,
  start_session: Play,
  account_usage: Gauge,
  switch_account: UserCog,
  open_in_seal: AppWindow
}

/** One line that says what the call does, in the words of the tool's own arguments. */
export function homeChatToolSummary(tool: string, input: Record<string, unknown>): string {
  const str = (key: string): string => String(input[key] ?? '')
  switch (tool) {
    case 'run_command':
      return `${input.background === true ? '& ' : '$ '}${str('command')}`
    case 'codex_shell':
      return `$ ${str('command')}`
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
    case 'list_skills':
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
    case 'list_sessions':
      return str('machine')
    case 'read_session':
    case 'take_over_session':
      return str('session_id')
    case 'message_session':
      return str('text')
    case 'start_session':
      return str('prompt')
    case 'account_usage':
      return str('provider')
    case 'switch_account':
      return `${str('provider')} → ${str('account')}`
    case 'open_in_seal':
      return [str('target'), str('id')].filter(Boolean).join(' ')
    default:
      return Object.keys(input).length > 0 ? JSON.stringify(input) : ''
  }
}
