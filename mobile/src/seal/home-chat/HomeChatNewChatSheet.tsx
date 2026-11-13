import { useEffect, useState } from 'react'
import type {
  HomeChatAccountOption,
  HomeChatBackendKind
} from '../../../../src/shared/home-chat/home-chat-types'
import { PickerModal, type PickerOption } from '../../components/PickerModal'
import { useMobileTranslation } from '../../i18n/use-mobile-translation'
import type { RpcClient } from '../../transport/rpc/rpc-client-contract'
import { fetchHomeChatAccounts } from './home-chat-operations'

export type HomeChatNewChatChoice = { backend: HomeChatBackendKind; accountId: string | null }

const CLAUDE_PREFIX = 'claude:'
const MODEL_API = 'openai'

/** Picks where a new chat runs: a Claude account (the default login first) or the configured model API. */
export function HomeChatNewChatSheet({
  visible,
  client,
  onPick,
  onClose
}: {
  visible: boolean
  client: RpcClient | null
  onPick: (choice: HomeChatNewChatChoice) => void
  onClose: () => void
}) {
  const t = useMobileTranslation()
  const [accounts, setAccounts] = useState<HomeChatAccountOption[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!visible || !client) {
      return
    }
    let live = true
    setFailed(false)
    fetchHomeChatAccounts(client).then(
      (next) => live && setAccounts(next),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
  }, [visible, client])

  const claudeAccounts: HomeChatAccountOption[] = accounts ?? [
    { id: null, label: t('seal.homeChat.account.default', 'Default login') }
  ]
  const options: PickerOption[] = [
    ...claudeAccounts.map((account) => ({
      value: `${CLAUDE_PREFIX}${account.id ?? ''}`,
      label: t('seal.homeChat.newChat.claude', 'Claude Code · {{account}}', {
        account:
          account.id === null ? t('seal.homeChat.account.default', 'Default login') : account.label
      }),
      subtitle: account.detail
    })),
    {
      value: MODEL_API,
      label: t('seal.homeChat.backend.openai', 'Model API'),
      subtitle: t('seal.homeChat.newChat.openaiDetail', 'Uses the model set on the desktop')
    }
  ]

  return (
    <PickerModal
      visible={visible}
      title={t('seal.homeChat.newChat.title', 'New chat')}
      subtitle={
        failed
          ? t('seal.homeChat.newChat.accountsFailed', 'Could not load Claude accounts')
          : undefined
      }
      options={options}
      selected=""
      onSelect={(value) => {
        onClose()
        if (value === MODEL_API) {
          onPick({ backend: 'openai-compatible', accountId: null })
          return
        }
        const id = value.slice(CLAUDE_PREFIX.length)
        onPick({ backend: 'claude-code', accountId: id === '' ? null : id })
      }}
      onClose={onClose}
    />
  )
}
