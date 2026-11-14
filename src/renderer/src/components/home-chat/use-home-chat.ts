import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import {
  mergeHomeChatEntries,
  mergeHomeChatEntry
} from '../../../../shared/home-chat/home-chat-entry-merge'
import type {
  HomeChat,
  HomeChatAccountOption,
  HomeChatEntry,
  HomeChatMachineOption,
  HomeChatSettings,
  HomeChatSettingsUpdate,
  HomeChatSummary,
  HomeChatUpdateArgs
} from '../../../../shared/home-chat/home-chat-types'
import { registerHomeChatThreadSelector } from './home-chat-open-target'

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
  const [machines, setMachines] = useState<HomeChatMachineOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [memoryVersion, setMemoryVersion] = useState(0)
  const activeIdRef = useRef<string | null>(null)
  // Entries streamed while the thread's snapshot is still loading; merged in when it lands.
  const earlyEntries = useRef<HomeChatEntry[]>([])

  const guard = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    setError(null)
    try {
      return await action()
    } catch (caught) {
      setError(errorText(caught))
      return undefined
    }
  }, [])

  const select = useCallback((chatId: string | null) => {
    if (activeIdRef.current !== chatId) {
      activeIdRef.current = chatId
      earlyEntries.current = []
      setActiveId(chatId)
    }
  }, [])

  const refreshMachines = useCallback(
    () => void api.listMachines().then(setMachines, () => undefined),
    [api]
  )

  useEffect(() => {
    let live = true
    const unsubscribe = api.onEvent((event) => {
      if (event.type === 'entry') {
        if (event.chatId !== activeIdRef.current) {
          return
        }
        earlyEntries.current = mergeHomeChatEntry(earlyEntries.current, event.entry)
        setActive((prev) =>
          prev?.id === event.chatId
            ? { ...prev, entries: mergeHomeChatEntry(prev.entries, event.entry) }
            : prev
        )
      } else if (event.type === 'summary') {
        setChats((list) => upsertSummary(list, event.chat))
        setActive((prev) => (prev?.id === event.chat.id ? { ...prev, ...event.chat } : prev))
      } else if (event.type === 'deleted') {
        setChats((list) => list.filter((chat) => chat.id !== event.chatId))
        if (activeIdRef.current === event.chatId) {
          select(null)
        }
      } else if (event.type !== 'open') {
        setMemoryVersion((version) => version + 1)
      }
    })
    void Promise.all([api.list(), api.getSettings(), api.listAccounts()]).then(
      ([list, loadedSettings, loadedAccounts]) => {
        if (!live) {
          return
        }
        setChats(list)
        setSettings(loadedSettings)
        setAccounts(loadedAccounts)
        if (activeIdRef.current === null) {
          // Resume where the user left off: the thread they touched last, not a background worker.
          select((list.find((chat) => !chat.parentChatId) ?? list[0])?.id ?? null)
        }
      },
      (caught: unknown) => live && setError(errorText(caught))
    )
    refreshMachines()
    return () => {
      live = false
      unsubscribe()
    }
  }, [api, select, refreshMachines])

  useEffect(() => registerHomeChatThreadSelector(select), [select])

  useEffect(() => {
    if (!activeId) {
      setActive(null)
      return
    }
    let live = true
    setActive((prev) => (prev?.id === activeId ? prev : null))
    void api.get({ chatId: activeId }).then((chat) => {
      if (!live) {
        return
      }
      setActive(
        chat ? { ...chat, entries: mergeHomeChatEntries(chat.entries, earlyEntries.current) } : null
      )
      earlyEntries.current = []
    })
    return () => {
      live = false
    }
  }, [api, activeId])

  const adopt = useCallback((chat: HomeChat) => {
    activeIdRef.current = chat.id
    earlyEntries.current = []
    setActive(chat)
    setActiveId(chat.id)
  }, [])

  const newChat = useCallback(async () => {
    const chat = await guard(() =>
      api.create(
        active ? { backend: active.backend, accountId: active.accountId, model: active.model } : {}
      )
    )
    if (chat) {
      adopt(chat)
    }
    return chat
  }, [api, guard, active, adopt])

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

  const attachments = useMemo(
    () => ({
      read: (attachmentId: string) => api.readAttachment({ chatId: activeId ?? '', attachmentId }),
      save: (attachmentId: string, name: string) =>
        void guard(() => api.saveAttachment({ chatId: activeId ?? '', attachmentId, name })),
      reveal: (attachmentId: string) =>
        void guard(() => api.revealAttachment({ chatId: activeId ?? '', attachmentId }))
    }),
    [api, guard, activeId]
  )

  return {
    chats,
    attachments,
    memoryVersion,
    active,
    settings,
    accounts,
    machines,
    error,
    dismissError: () => setError(null),
    select,
    newChat,
    send,
    stop: () => activeId && void guard(() => api.stop({ chatId: activeId })),
    compact: () => activeId && void guard(() => api.compact({ chatId: activeId })),
    remove: (chatId: string) => void guard(() => api.delete({ chatId })),
    rename: (chatId: string, title: string) => void guard(() => api.update({ chatId, title })),
    respondApproval: (entryId: string, approved: boolean) =>
      activeId && void guard(() => api.respondApproval({ chatId: activeId, entryId, approved })),
    updateChat: async (patch: Omit<HomeChatUpdateArgs, 'chatId' | 'title'>) => {
      if (activeId) {
        await guard(() => api.update({ chatId: activeId, ...patch }))
        return
      }
      const chat = await guard(() => api.create(patch))
      if (chat) {
        adopt(chat)
      }
    },
    saveSettings: async (update: HomeChatSettingsUpdate) => {
      const next = await guard(() => api.updateSettings(update))
      if (next) {
        setSettings(next)
      }
      return next !== undefined
    },
    refreshAccounts: () => void api.listAccounts().then(setAccounts, () => undefined),
    refreshMachines
  }
}
