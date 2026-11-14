import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import { useTranslate } from '@/i18n/use-translate'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import type { HomeChatApi } from '../../../../preload/api/home-chat/home-chat-api'
import type { HomeChatMemory } from '../../../../shared/home-chat/home-chat-memory-types'
import { HomeChatMachineNotes, HomeChatMemoryItems } from './HomeChatMemorySections'

/** What the assistant remembers across chats, editable by the user. */
export function HomeChatMemoryDialog({
  api,
  memoryVersion
}: {
  api: HomeChatApi
  /** Bumps when the assistant changes memory, so an open editor reloads. */
  memoryVersion: number
}): React.JSX.Element {
  const t = useTranslate()
  const [open, setOpen] = useState(false)
  const [memory, setMemory] = useState<HomeChatMemory | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || dirty) {
      return
    }
    let live = true
    void api.getMemory().then((loaded) => live && setMemory(loaded))
    return () => {
      live = false
    }
  }, [api, open, dirty, memoryVersion])

  const update = (patch: Partial<HomeChatMemory>): void => {
    setMemory((current) => (current ? { ...current, ...patch } : current))
    setDirty(true)
  }

  const save = async (): Promise<void> => {
    if (!memory) {
      return
    }
    setSaving(true)
    const saved = await api.updateMemory({ memory }).catch(() => null)
    setSaving(false)
    if (saved) {
      setMemory(saved)
      setDirty(false)
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => setOpen(true)}
        aria-label={t('homeChat.memory.open', 'Memory')}
      >
        <Brain />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setDirty(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('homeChat.memory.title', 'Assistant memory')}</DialogTitle>
            <DialogDescription>
              {t(
                'homeChat.memory.description',
                'Read by the assistant at the start of every turn, in every chat. It adds to this as it works; edit anything here.'
              )}
            </DialogDescription>
          </DialogHeader>
          {memory && (
            <Tabs defaultValue="rules">
              <TabsList>
                <TabsTrigger value="rules">{t('homeChat.memory.rules', 'Rules')}</TabsTrigger>
                <TabsTrigger value="facts">{t('homeChat.memory.facts', 'Facts')}</TabsTrigger>
                <TabsTrigger value="machines">
                  {t('homeChat.memory.machines', 'Machines')}
                </TabsTrigger>
                <TabsTrigger value="journal">{t('homeChat.memory.journal', 'Journal')}</TabsTrigger>
              </TabsList>
              <TabsContent value="rules">
                <HomeChatMemoryItems
                  items={memory.rules}
                  placeholder={t(
                    'homeChat.memory.rulePlaceholder',
                    'e.g. Always push to a feature branch'
                  )}
                  emptyText={t('homeChat.memory.rulesEmpty', 'No standing rules yet.')}
                  onChange={(rules) => update({ rules })}
                />
              </TabsContent>
              <TabsContent value="facts">
                <HomeChatMemoryItems
                  items={memory.facts}
                  placeholder={t(
                    'homeChat.memory.factPlaceholder',
                    'e.g. The GPU box is called tower'
                  )}
                  emptyText={t('homeChat.memory.factsEmpty', 'No facts yet.')}
                  onChange={(facts) => update({ facts })}
                />
              </TabsContent>
              <TabsContent value="machines">
                <HomeChatMachineNotes
                  notes={memory.machines}
                  onChange={(machines) => update({ machines })}
                />
              </TabsContent>
              <TabsContent value="journal">
                <HomeChatMemoryItems
                  items={memory.journal}
                  showDates
                  placeholder={t('homeChat.memory.journalPlaceholder', 'Add a note')}
                  emptyText={t('homeChat.memory.journalEmpty', 'Nothing logged yet.')}
                  onChange={(journal) => update({ journal })}
                />
              </TabsContent>
            </Tabs>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('homeChat.memory.cancel', 'Cancel')}
            </Button>
            <Button disabled={!dirty || saving} onClick={() => void save()}>
              {t('homeChat.memory.save', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
