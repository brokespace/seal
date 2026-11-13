import { useCallback, useEffect, useState } from 'react'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import { mergeHomeChatEntry } from '../../../../shared/home-chat/home-chat-entry-merge'
import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatSettings,
  HomeChatSettingsUpdate,
  HomeChatSummary,
  HomeChatUpdateArgs
} from '../../../../shared/home-chat/home-chat-types'

function upsertSummary(list: HomeChatSummary[], chat: HomeChatSummary): HomeChatSummary[] {
  return [chat, ...list.filter((existing) => existing.id !== chat.id)].sort(
    (a, b) => b.updatedAt - a.updatedAt
  )
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Electron prefixes IPC rejections with the channel; the user only needs the reason.
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

export type HomeChatState = ReturnType<typeof useHomeChat>

export function useHomeChat(api: HomeChatApi) {
  const [chats, setChats] = useState<HomeChatSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [active, setActive] = useState<HomeChat | null>(null)
  const [settings, setSettings] = useState<HomeChatSettings | null>(null)
  const [accounts, setAccounts] = useState<HomeChatAccountOption[]>([])
  const [error, setError] = useState<string | null>(null)

  const guard = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setError(null)
    try {
      return await action()
    } catch (caught) {
      setError(errorText(caught))
      return undefined
    }
  }, [])

  useEffect(() => {
    let live = true
    void Promise.all([api.list(), api.getSettings(), api.listAccounts()]).then(
      ([list, loadedSettings, loadedAccounts]) => {
        if (!live) {
          return
        }
        setChats(list)
        setSettings(loadedSettings)
        setAccounts(loadedAccounts)
        setActiveId((current) => current ?? list[0]?.id ?? null)
      },
      (caught: unknown) => live && setError(errorText(caught))
    )
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'entry') {
        setActive((prev) =>
          prev?.id === event.chatId
            ? { ...prev, entries: mergeHomeChatEntry(prev.entries, event.entry) }
            : prev
        )
      } else if (event.type === 'summary') {
        setChats((list) => upsertSummary(list, event.chat))
        setActive((prev) => (prev?.id === event.chat.id ? { ...prev, ...event.chat } : prev))
      } else {
        setChats((list) => list.filter((chat) => chat.id !== event.chatId))
        setActiveId((current) => (current === event.chatId ? null : current))
      }
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [api])

  useEffect(() => {
    if (!activeId) {
      setActive(null)
      return
    }
    let live = true
    void api.get({ chatId: activeId }).then((chat) => live && setActive(chat))
    return () => {
      live = false
    }
  }, [api, activeId])

  const newChat = useCallback(async () => {
    const chat = await guard(() =>
      api.create(
        active ? { backend: active.backend, accountId: active.accountId, model: active.model } : {}
      )
    )
    if (chat) {
      setActive(chat)
      setActiveId(chat.id)
    }
    return chat
  }, [api, guard, active])

  const send = useCallback(
    async (text: string) => {
      const chatId = activeId ?? (await newChat())?.id
      if (!chatId) {
        return false
      }
      return (await guard(() => api.send({ chatId, text }).then(() => true))) ?? false
    },
    [api, guard, activeId, newChat]
  )

  return {
    chats,
    active,
    settings,
    accounts,
    error,
    dismissError: () => setError(null),
    select: setActiveId,
    newChat,
    send,
    stop: () => activeId && void guard(() => api.stop({ chatId: activeId })),
    remove: (chatId: string) => void guard(() => api.delete({ chatId })),
    respondApproval: (entryId: string, approved: boolean) =>
      activeId && void guard(() => api.respondApproval({ chatId: activeId, entryId, approved })),
    updateChat: async (patch: Omit<HomeChatUpdateArgs, 'chatId'>) => {
      if (activeId) {
        await guard(() => api.update({ chatId: activeId, ...patch }))
        return
      }
      const { title: _title, ...runtime } = patch
      const chat = await guard(() => api.create(runtime))
      if (chat) {
        setActive(chat)
        setActiveId(chat.id)
      }
    },
    saveSettings: async (update: HomeChatSettingsUpdate) => {
      const next = await guard(() => api.updateSettings(update))
      if (next) {
        setSettings(next)
      }
      return next !== undefined
    },
    refreshAccounts: () => void api.listAccounts().then(setAccounts, () => undefined)
  }
}
