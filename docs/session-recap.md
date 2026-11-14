# Session recap

A rolling recap of each agent session: a stable title for its row, and an overview you read when
you come back to it. It runs on the same utility model, summarizer host, cache folder and registry
sync as the one-line status summaries ([AI session summaries](./TESTING-seal-all.md)); there is no
second pipeline.

## The problem

Brian runs many agent sessions across machines and returns to each one hours or days later. By
then he has forgotten:

- what the session was for, and why he started it;
- what he asked along the way, and which of those the agent never got to;
- what the agent asked _him_ that he never answered;
- what he was supposed to do himself as a result (run a command, review a PR, set a secret);
- what was decided, and what was touched.

The transcript has all of it, but as hundreds of messages and tool calls. The one-line summary
only describes the last stop. The session's label is its first prompt, which stops describing the
session after the first turn.

## User stories

1. **Recognize it in a list.** "I look at Active agents and each row says what that session is
   about, not what I typed first. If I named it myself, my name stays."
2. **Remember it on open.** "I open a session and, without scrolling, see what it's for, where it
   stands, and what changed since I last looked."
3. **See what's on me.** "Rows that have a question for me, or something I still have to do, carry
   a badge. I can tick those off, and they stay ticked on my phone too."
4. **Catch what was missed.** "I can see requests of mine the agent skipped, and questions it
   asked that I never answered."
5. **Go to the source.** "Every line in the recap takes me to the message it came from."
6. **Trust the cost.** "It never burns through the free Workers AI allocation, and when it can't
   run it says so instead of showing something stale as if it were fresh."

## What the recap contains

| Section               | What it holds                                                                                   | Made by        |
| --------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| Title                 | Up to six words naming the session. Used as its label (see precedence).                         | model, guarded |
| Goal and why          | One sentence: what he wants and the purpose behind it.                                          | model          |
| Where it stands       | One or two sentences on the current state.                                                      | model          |
| Since you last looked | Counts of what entered the recap after his previous visit; those rows are marked new.           | host, no model |
| Open questions        | Questions the agent put to him that are still unanswered. Can be ticked or dismissed.           | model          |
| Action items          | Things he must do himself: said he would, or the agent told him to. Can be ticked or dismissed. | model          |
| Not addressed         | Requests of his the agent never acted on. Can be dismissed.                                     | model          |
| What I asked          | Each of his requests, condensed to a line, oldest first.                                        | model          |
| What the agent did    | Work items, each `done`, `in-progress` or `blocked`.                                            | model          |
| Decisions             | Choices made, by either side.                                                                   | model          |
| Files, PRs and links  | Files the agent edited, pull requests and URLs mentioned.                                       | host, no model |

Two sections cost nothing. _Files, PRs and links_ is read off the transcript's edit tool calls
(their paths only) and the URLs in the prose. _Since you last looked_ compares each item's arrival
time with the previous visit. Both are exact, which a model would not be.

## Information model

```ts
type SessionRecap = {
  version: 1
  title: string | null
  titleChangedAt: number | null
  goal: string | null
  standing: string | null
  asked: RecapItem[]
  did: RecapItem[] // each carries `state`
  questions: RecapItem[]
  ignored: RecapItem[]
  actions: RecapItem[]
  decisions: RecapItem[]
  references: RecapReference[]
  updatedAt: number
  coveredFrom: number // transcript byte offset the recap starts at (0 = whole session)
  coveredTo: number // transcript byte offset it has read up to
  nextItemId: number
  degraded?: true // the last pass fell back to what the host can read without the model
}

type RecapItem = {
  id: string // `q3`: stable for the life of the session
  text: string
  messageId: string | null // the transcript message it came from (`o<byte offset>`)
  at: number // when it entered the recap
  state?: 'done' | 'in-progress' | 'blocked'
}

type RecapReference = {
  kind: 'file' | 'pr' | 'link'
  label: string
  target: string
  messageId: string | null
  at: number
}
```

Stored beside it, per session and owned by the user rather than the model:

```ts
type RecapMarks = Record<string /* item id */, 'done' | 'dismissed'>
lookedAt: number | null // this visit
previousLookedAt: number | null // the visit before: what "since you last looked" measures from
```

What rides on every `LiveSession` in the registry (and so reaches every client through the sync
that already carries `summary`):

```ts
recap?: { title: string | null; rev: number; questions: number; actions: number; updating?: true }
```

`questions` and `actions` count only unticked, undismissed items, so the badge is right without
fetching the recap. `rev` rises on every change, including a tick on another device; a client
holding an older `rev` fetches the recap again. Nothing else is pushed.

### Why item ids are the host's

The model never rewrites the recap. It returns a **delta**: items to add, items to update by id,
ids to resolve. The host assigns ids, so an item keeps its id for as long as it exists. That is
what lets a tick survive the next recompute, and it keeps every untouched line byte-for-byte the
same, so nothing flickers. A delta is also a fraction of the output tokens of a full rewrite, and
output is the expensive side (36.4 neurons per 1k tokens against 5.5 for input).

### Title precedence

1. The name he set in Seal (`customTitle`).
2. The name he set in the agent itself (Claude's `/rename`, a `custom-title` transcript record;
   surfaced as `titleNamed`).
3. The recap title.
4. The provider's title (its own summary, else the first prompt), then the project.

The recap never writes to 1 or 2 and is never stored in their place. One function,
`liveSessionLabel`, decides this for desktop, mobile and notifications.

**Stability.** The title is only considered when a recap pass runs (never per message). The model
is told to return `null` unless the session's purpose changed. The host then refuses a
replacement that shares half or more of its significant words with the current title (a
rephrasing), and refuses any change within 10 minutes of the last one. A session that pivots gets
a new title once; one that keeps working on the same thing keeps its title.

## When it is recomputed

Always incrementally: the previous recap, compacted, plus the messages since `coveredTo`. The
transcript is never re-read from the start.

| Trigger                                                                         | Rule                                                                                                                                        |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The session stops (`waiting-input`, `idle`, `waiting-subagent`, `waiting-task`) | Same stop detection as status summaries. At most one pass per session every 4 minutes; a stop inside that window is picked up when it ends. |
| He opens the session                                                            | If the transcript has moved past `coveredTo`, one pass now, whatever the session's status.                                                  |
| Refresh recap                                                                   | A pass now. When nothing is new it rebuilds from the recent history instead (ticks kept by matching text).                                  |
| The transcript shrank (rewritten)                                               | Start over from the recent history.                                                                                                         |

A working session is not recapped on its own: its turn is not a fact yet. A headless server only
keeps up sessions someone has opened from a client paired to it, so a desktop and a server that
both see a session do not both pay for it.

## Reading and chunking the transcript

What reaches the model is conversation prose only: his messages and the agent's own text. Tool
calls, tool output and reasoning are never sent. Each message is stripped of code blocks and
terminal escapes, passed through the app's redactor, and clipped (his messages to 1,500
characters; an agent turn, merged into one entry, to 1,800 with its end favoured, where the
outcome and any question sit).

- **Incremental pass.** Read forward from `coveredTo` (`readTranscriptForward`, the reader the
  chat view tails with). Typically one turn: a few hundred tokens.
- **First pass.** Page backward from the end (`transcriptPage`) until 3 chunks' worth of prose
  is collected or the start is reached. Older history is left out and `coveredFrom` says so; the
  UI states "covers the last N messages". The first prompt still informs the goal: it is the
  provider title the registry already holds.
- **Chunks.** 24,000 characters of prose each (about 6.9k tokens), processed oldest to newest,
  each call carrying the rolling recap forward. At most 1 chunk for an automatic first pass, 3
  for a pass he asked for. Anything beyond that is dropped from the old end, never from the new.

The context window (131k tokens) is never the constraint; the daily allocation is.

## Neuron budget

Rates ([Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)):
`glm-4.7-flash` 5,500 neurons per M input tokens and 36,400 per M output; the fallback
`gemma-4-26b-a4b-it` 9,091 and 27,273. Free allocation: 10,000 neurons a day, shared with the
status summaries. Tokens are estimated at 3.5 characters each.

| Call                                      | Input tokens                     | Output tokens | Neurons |
| ----------------------------------------- | -------------------------------- | ------------- | ------- |
| Typical update (one turn)                 | 450 system + 600 recap + 600 new | 250           | ~18     |
| Full chunk (first pass, long gap)         | 450 + 900 + 6,900                | 700           | ~71     |
| Worst case (repair retry of a full chunk) | 2 x 8,250 + 600                  | 2 x 1,000     | ~167    |
| Status summary, for comparison            | 600                              | 30            | ~4.4    |

A day of 150 turns across all sessions is about 2,700 neurons of recaps plus 660 of summaries.
The host keeps its own tally (per UTC day, persisted) and enforces:

- **Automatic passes stop at 6,000 neurons** of recap work a day. Rows keep their last recap and
  the panel says updates resume tomorrow.
- **Passes he asks for** (open, Refresh) run until 9,000.
- A 429 or a spent allocation pauses every utility request through `UtilityModelService`, as it
  does for summaries; the recap shows the same "paused until" note.

Recaps can be turned off on their own (Settings > Accounts > Cloudflare Workers AI) without
losing the one-line summaries.

## Structured output

`glm-4.7-flash` is not on Workers AI's JSON Mode list and the fallback model differs, so the
schema is enforced by the host, not the API:

1. The prompt gives the delta's shape and asks for one JSON object and nothing else.
2. The reply is read leniently: code fences and stray prose around the object are dropped.
3. It is validated with zod. A wrong field or item is discarded on its own; the reply fails only
   when it is not an object or holds nothing recognizable. Text is clipped, `ref`s that name no
   message in the chunk become unlinked items, ids that name no item are ignored.
4. On failure, **one retry** that shows the model its reply and the error.
5. On a second failure, a **fallback** with no model: his messages become "What I asked" lines
   (their first line), files and links are still collected, the cursor still advances, and the
   recap is marked degraded so the panel can say so. A bad chunk never loops or blocks later ones.

A failure of the provider itself (network, auth, rate limit) is different: nothing advances, the
panel shows why, and the next trigger tries again.

```jsonc
{
  "title": "Recap panel for agent sessions", // or null to keep
  "goal": "…", // or null to keep
  "standing": "…",
  "add": {
    "asked": [{ "text": "…", "ref": "m3" }],
    "did": [{ "text": "…", "state": "in-progress", "ref": "m4" }],
    "questions": [],
    "ignored": [],
    "actions": [],
    "decisions": []
  },
  "update": [{ "id": "w2", "state": "done" }],
  "resolve": ["q1", "t3"]
}
```

## Where it runs and how it syncs

- `SessionSummariesHost` owns it, next to the status summaries: same `UtilityModelService`
  (fallback model, pause on 429), same availability check, same settings store, same registry
  decorator and `republish`.
- State lives in `<userData>/session-recaps/` through `LiveSessionJsonStore` (atomic, mode 600),
  the store annotations use. It follows a session through a resume (`replacedBy`), as
  annotations do.
- Clients read and change it over three runtime RPC methods, used alike by the desktop renderer
  and the phone: `sessionRecap.get`, `sessionRecap.refresh`, `sessionRecap.mark`.
- A tick on the phone bumps `rev` on the session; the registry stream delivers it to the desktop,
  which fetches the recap again. No new channel.

## UI

Desktop, inside the session view (`LiveSessionPane`):

- **Recap bar** under the header, one line: where it stands, then chips for open questions and
  action items, and a dot when something arrived since he last looked. It is what he sees on
  open. Clicking it opens the panel.
- **Recap panel**, a fourth side panel beside Subagents, Tasks and Reasoning, with the same
  chrome. Top to bottom: since you last looked; goal; where it stands; open questions and action
  items (checkbox, dismiss); not addressed; what I asked; what the agent did; decisions; files,
  PRs and links. Each row jumps to its message, paging older history in when needed. The footer
  has "Updated 5 min ago", what the recap covers, and Refresh recap.
- **Badge** on Active agents rows and Home session cards: open questions and open action items.

Mobile, over the same RPC:

- The same badge on session rows, and the same label precedence.
- A recap banner above the transcript, and a sheet with the same sections, ticks and Refresh.
  Rows jump to their message when it is loaded.

States: writing the first recap; up to date; out of date and updating; paused (rate limit) with
the time it resumes; budget spent for today; failed with the provider's reason; no utility model
on this host (the bar and panel are hidden).

## Not in this version

- A recap for sessions on a paired server is made by whichever hub the client talks to; the two
  hubs do not share ticks.
- Resolved questions and finished action items leave the list rather than moving to a history.
- The recap is not searchable and is not fed back to the agent.
