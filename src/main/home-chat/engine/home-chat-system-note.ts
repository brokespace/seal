import type { HomeChatUserItem } from '../thread/home-chat-thread-items'

const NOTE_LABEL =
  '[Automatic note from Seal, the app running this conversation. The user did not write it and will not see it.]'

/** Text Seal adds to steer the model, labelled so it is never mistaken for the user's words. */
export function systemNote(text: string): string {
  return `${NOTE_LABEL}\n${text}`
}

export const SUMMARY_HEADING =
  'Summary of the earlier part of this conversation, which is no longer in your context:'

export const SUMMARY_REQUEST = `The conversation is about to outgrow your context, so the older part will be replaced by a summary you write now. Do not call tools. Reply with only the summary, as plain prose and short lists:
- what the user wants overall and any standing instructions they gave
- what was done, on which machines, with the exact commands, paths, ids and names that matter
- what was learned (facts about machines, repositories, accounts, errors hit and how they were resolved)
- what is still open or was promised
Keep every detail a later turn would need to continue without re-asking or re-discovering. Leave out pleasantries and anything already superseded.`

export const EMPTY_NUDGE =
  'Your last reply was empty. Answer the user, or call a tool if you still need something.'

export const CUT_OFF_NUDGE =
  'Your last reply was cut off at the output limit. Continue exactly where it stopped; do not repeat what you already wrote.'

export const ROUND_LIMIT_TEXT = (rounds: number): string =>
  `Paused after ${rounds} steps in one turn. Send a message to continue.`

/** A notice is Seal speaking: say so, and say what is expected. */
function noticeText(item: HomeChatUserItem): string {
  return `[Automatic notice from Seal${item.source ? ` (${item.source})` : ''}. The user did not write this.]\n${item.text}\n\nThis arrived on its own. Verify the outcome if it matters, then tell the user briefly what happened and what (if anything) you did next.`
}

/** The words a model receives for a user-role item. */
export function modelTextForUserItem(item: HomeChatUserItem): string {
  if (item.origin === 'user') {
    return item.text
  }
  return item.origin === 'notice' ? noticeText(item) : systemNote(item.text)
}
