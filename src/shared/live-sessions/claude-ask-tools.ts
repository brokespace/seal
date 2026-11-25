/** Claude tools that hand the turn to the user: the call stays open until they answer. */
export const CLAUDE_ASK_TOOLS: Partial<Record<string, string>> = {
  AskUserQuestion: 'Question for you',
  ExitPlanMode: 'Plan ready for review'
}

export function isClaudeAskTool(name: string): boolean {
  return CLAUDE_ASK_TOOLS[name] !== undefined
}
