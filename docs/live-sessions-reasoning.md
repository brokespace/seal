# Live sessions: reasoning

A session's reasoning is drawn in its transcript, where the agent thought it: an open "Thought
for 4s" row with the text under it, between the messages and calls around it. There is no
separate reasoning panel. When a provider recorded a thought without readable text, nothing is
drawn for it.

## What Claude Code records

Checked against the Claude Code 2.1.325 binary and its changelog.

- **Transcript JSONL** (`~/.claude/projects/<cwd>/<session>.jsonl`): one `assistant` record per
  content block. A thought is `message.content: [{ "type": "thinking", "thinking": "...",
  "signature": "..." }]`, with `thinkingDurationMs` and `thinkingDisplay` on the record.
  `thinking` holds the API's summary of the thought, or is empty when no summary was requested;
  the signature is opaque. A `redacted_thinking` block carries only encrypted `data`.
- **Whether a summary is requested** is the API's `thinking.display`. Since 2.1.89 an
  interactive session requests none unless `showThinkingSummaries` is `true` in `settings.json`,
  or it was started with `--thinking-display summarized` (a hidden flag, 2.1.94+; the other values
  are `omitted` and `highlights`, the latter only on Anthropic-hosted sessions). With neither,
  the transcript keeps each thought as an empty `thinking` plus its signature, or as a record with
  no content and `thinkingDisplay: "updates"`. That is what Seal used to describe as "stored
  encrypted".
- **`--output-format stream-json`**: the same blocks in `assistant` messages
  (`thinking_duration_ms`, `thinking_display` beside a thinking-only one). With
  `--include-partial-messages`, `stream_event` `content_block_delta` events of type
  `thinking_delta` carry the summary as it arrives. Plain `-p` output asks for `omitted`.

## How Seal gets the text

- **Sessions in a terminal**, started by Seal or not, are read from the transcript file. The
  managed hook installer (`ClaudeHookService`, the code that writes Seal's hooks into
  `settings.json` on this machine, in account profiles and on SSH hosts) also sets
  `showThinkingSummaries: true` when the key is absent and the installed Claude Code is 2.1.89 or
  newer (`claude-thinking-summaries.ts`). A value the user set, `true` or `false`, is left alone;
  setting it to `false` is how to opt out. It applies to turns after the next time Claude Code
  reads its settings; thoughts already recorded without a summary stay unreadable.
- **Structured sessions** are started with `--thinking-display summarized` when the CLI accepts
  the flag (`claude-structured-launch-flags.ts`) and journal `thinking_delta` text as it streams.

## Codex

A rollout's `response_item` of type `reasoning` holds `summary` (`summary_text` parts),
optionally `content` (the raw reasoning, for models and configurations that expose it, see
`show_raw_agent_reasoning`), and `encrypted_content`. Codex writes summaries by default for
models that support them (`model_reasoning_summary`), so Seal changes no Codex setting. The
transcript shows the summary, else the raw text, else nothing.
