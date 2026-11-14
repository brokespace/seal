import { describe, expect, it } from 'vitest'
import { assessHomeChatToolRisk, assessShellCommandRisk } from './home-chat-tool-risk'

describe('assessShellCommandRisk', () => {
  it.each([
    ['cd /tmp && rm -rf build', 'This command deletes files.'],
    ['git push --force origin main', 'This command force-pushes.'],
    ['git push origin +main', 'This command force-pushes.'],
    ['git -C repo reset --hard HEAD~1', 'This command discards uncommitted work.'],
    [
      'curl -X POST https://hooks.example.com -d @payload.json',
      'This command sends data over the network.'
    ],
    ['echo hi | sendmail bob@example.com', 'This command sends email.'],
    ['ls $(rm -rf ~)', 'This command deletes files.']
  ])('asks before %s', (command, reason) => {
    expect(assessShellCommandRisk(command)).toEqual({ requiresApproval: true, reason })
  })

  it.each([
    'ls -la ~/projects',
    'git status && git log --oneline -5',
    'git push origin feature/x',
    'curl -s https://example.com/health',
    'grep -r "rm -rf" docs'
  ])('runs %s without asking', (command) => {
    expect(assessShellCommandRisk(command)).toEqual({ requiresApproval: false })
  })
})

describe('assessHomeChatToolRisk', () => {
  it('always asks before deleting a path', () => {
    expect(assessHomeChatToolRisk('delete_path', { machine: 'local', path: '/tmp/x' })).toEqual({
      requiresApproval: true,
      reason: 'This deletes /tmp/x.'
    })
  })

  it('asks before removing a worktree but not before launching an agent', () => {
    expect(
      assessHomeChatToolRisk('seal_cli', { args: ['worktree', 'rm', '--worktree', 'id:1'] })
    ).toMatchObject({ requiresApproval: true })
    expect(
      assessHomeChatToolRisk('seal_cli', { args: ['agent', 'launch', '--agent', 'claude'] })
    ).toEqual({ requiresApproval: false })
  })
})
