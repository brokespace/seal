import { useMemo, useState } from 'react'
import { useTranslate } from '@/i18n/use-translate'
import type { ChatApproval } from '../../../../../shared/native-chat/input/native-chat-interactive-prompt'
import { NativeChatApprovalCard } from '../../native-chat/prompts/NativeChatApprovalCard'
import type { ExternalAgentSessionChatSource } from './use-external-agent-session-chat-source'

/** The session's permission prompt answers by option id only: `options` owns the composer's place. */
export function externalAgentSessionPromptOwnsComposer(
  source: Pick<ExternalAgentSessionChatSource, 'prompt' | 'capabilities'>
): boolean {
  return source.prompt !== null && source.capabilities.answer === 'options'
}

/**
 * The session's permission prompt in the chat's own prompt card. Answered by option id where the
 * session takes answers; where it takes none the card only shows what is asked.
 */
export function ExternalAgentSessionPrompt({
  source,
  shouldFocus,
  onAnswer,
  onAnswerFailed
}: {
  source: Pick<ExternalAgentSessionChatSource, 'prompt' | 'answer' | 'capabilities'>
  shouldFocus: boolean
  /** An answer is on its way: the reader follows the latest. */
  onAnswer: () => void
  onAnswerFailed: (error: unknown) => void
}): React.JSX.Element | null {
  const t = useTranslate()
  const { prompt, answer, capabilities } = source
  const [answering, setAnswering] = useState<{ promptId: string; optionId: string } | null>(null)
  const answerable = capabilities.answer !== 'none'
  const approval = useMemo<ChatApproval | null>(() => {
    if (!prompt) {
      return null
    }
    if (answerable) {
      return {
        title: prompt.question,
        options: prompt.options.map((option) => ({ label: option.label, send: option.id }))
      }
    }
    return {
      title: prompt.question,
      description: [
        ...prompt.options.map((option) => option.label),
        ...(prompt.options.length ? [''] : []),
        t(
          'seal.sessionTab.promptReadOnly',
          'Seal can’t answer this prompt. Answer it where the session runs.'
        )
      ].join('\n'),
      options: []
    }
  }, [prompt, answerable, t])
  if (!prompt || !approval) {
    return null
  }
  const sending = answering?.promptId === prompt.promptId ? answering.optionId : null
  return (
    <NativeChatApprovalCard
      key={prompt.promptId}
      approval={approval}
      onChoose={(optionId) => {
        const mine = { promptId: prompt.promptId, optionId }
        setAnswering(mine)
        onAnswer()
        void answer(prompt.promptId, { kind: 'option', optionId })
          .catch(onAnswerFailed)
          .finally(() => setAnswering((current) => (current === mine ? null : current)))
      }}
      isSubmitting={sending !== null}
      submittingOption={sending ?? undefined}
      shouldFocus={shouldFocus && answerable}
      placement={externalAgentSessionPromptOwnsComposer(source) ? 'composer' : 'stacked'}
    />
  )
}
