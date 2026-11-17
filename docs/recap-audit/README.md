# Session recap audit

An audit of the session recap on `seal/all` at 7a6dc74d5d2, a baseline of how it behaves before any fix, and a design for its overhaul. No product code is changed here.

|                                                        |                                                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| [01-pipeline-audit.md](./01-pipeline-audit.md)         | How the recap works today, with file and line references, and every bug and weakness found (F1 to F26).       |
| [02-scenario-baseline.md](./02-scenario-baseline.md)   | What was tested, how, and the results: 135 pipeline runs, model variance on 258 samples, and the in-app runs. |
| [03-overhaul-design.md](./03-overhaul-design.md)       | The proposed design, the builder workstreams and the decisions to make.                                       |
| [04-critique.md](./04-critique.md)                     | An independent review of the three above, with the changes required before builders start.                    |
| [labelling-rules.md](./labelling-rules.md)             | How each scenario's requests were labelled, blind, as the ground truth the judge models are scored against.   |
| [evidence/judge/report.md](./evidence/judge/report.md) | The judge measurement: every candidate against the labels, and the thresholds that came out of it.            |

The rest of the evidence the audit links to under `evidence/` is not kept on this branch: the full matrix (`matrix.json`, `matrix.md`), the model samples (`variance/`), the screenshots and recap JSON from the app (`e2e/`) and the judge's call log (`judge/calls.jsonl`). It is what a run writes, and `.gitignore` keeps a new run's copy local. The copies the audit was written from are at commit `9704849` (PR #61), for example `git show 9704849:docs/recap-audit/evidence/matrix.md`.

## The regression suite

`src/main/session-recap/scenarios/` runs written scenarios through the real recap pipeline: real transcript files or a real chat journal, the real scheduler, engine, parser, merge and store, the real utility-model service and Workers AI provider. Only two things are replaced: the clock, and the HTTP call to the model, which is answered from recorded replies of the real model.

```
pnpm test src/main/session-recap/scenarios --maxWorkers=2
```

It needs no network and no credential, and runs in under two seconds.

### Files

- `__fixtures__/scenarios/<id>.json`: one scenario. What the user and agent say and do, when time passes, when the user opens or refreshes the recap, when the model fails, and what the recap must show at each point. Each check carries a `why` in plain words. `surfaces` lists where it runs: `claude-cli`, `codex-cli`, `claude-ssh`, `chat-journal`.
- `__fixtures__/cassettes/<id>.json`: the recorded model replies for that scenario, keyed by a hash of the request and the model.
- `__fixtures__/baseline.json`: the checks that fail today, per run. The suite passes when exactly these fail. A fix removes entries; nothing should add one.

The schema for scenarios, with every step and check kind, is `recap-scenario-schema.test-fixture.ts`.

### Modes

| Environment                         | Effect                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| (none)                              | Replay. Fails on a request with no recorded reply, and on any difference from `baseline.json`.                               |
| `RECAP_SCENARIOS_ONLY=id1,id2`      | Run only these scenarios.                                                                                                    |
| `RECAP_SCENARIOS_REPORT=<dir>`      | Also write `matrix.json` and `matrix.md` there: expected, actual and result for every run.                                   |
| `RECAP_SCENARIOS_UPDATE_BASELINE=1` | Rewrite `baseline.json` from this run. Review the diff: it should only shrink.                                               |
| `RECAP_SCENARIOS_LIVE=1`            | Ask the real model for anything not recorded and save the reply. Needs an OpenRouter key or a Workers AI credential (below). |
| `RECAP_SCENARIOS_PENDING=<file>`    | Without a credential: write the unanswered requests to this file instead of failing.                                         |
| `RECAP_SCENARIOS_REPLIES=<file>`    | With the above: file replies to those requests (`[{ "contentHash", "model", "reply" }]`) into the cassettes before running.  |

A scenario with `"pending": true` has a request with no recording: it is new, or a change to the pipeline changed what it asks. It runs up to its first unrecorded request and stops. The checks it reaches before that are held to the baseline like any other; the ones after it are not run. Once it has recordings the suite fails until the mark is removed.

### The credential

A live run uses OpenRouter when the host has a key for it: `OPENROUTER_API_KEY` in the environment, else `apiKey` in `~/.config/seal/openrouter.json`. With no OpenRouter key it uses Workers AI: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the environment when both are set, else `~/.config/seal/cloudflare-ai.json`. It asks the provider about the credential first and stops if it is turned down, before anything is rewritten. No key or token is printed, and Cloudflare's error text is written with the account id replaced.

On OpenRouter the same models are asked through the app's own provider (`src/main/utility-model/live-workers-ai-fetch.test-fixture.ts`): `z-ai/glm-4.7-flash` and `google/gemma-4-26b-a4b-it` for the read step, and `cloudflare/clef` on Cloudflare's own host for the judge. Recordings are filed under the Workers AI ids either way, so a replay does not depend on which account recorded them. A chat reply recorded through OpenRouter carries no token count.

A live request that gets no answer after four tries fails the run and leaves the baseline and the matrix as they were. What was answered is kept, so the next run asks only for the rest.

### After changing the prompt or a scenario

A changed prompt changes every request, so every recording is stale.

1. Delete the cassettes for the scenarios affected (all of them for a prompt change).
2. `RECAP_SCENARIOS_LIVE=1 pnpm test src/main/session-recap/scenarios --maxWorkers=1`. Without a credential, use the pending and replies files instead and repeat until the pending file is empty: a later request depends on the reply to the earlier one.
3. `RECAP_SCENARIOS_REPORT=docs/recap-audit/evidence RECAP_SCENARIOS_UPDATE_BASELINE=1 pnpm test src/main/session-recap/scenarios`, then `pnpm exec oxfmt --write src/main/session-recap/scenarios/__fixtures__ docs/recap-audit/evidence/matrix.json`.
4. Read the diff of `baseline.json`, and `matrix.md` (written locally, not committed).

A recording is one sample of a model that varies. [The baseline](./02-scenario-baseline.md#how-much-the-model-varies) measures how much; the design asks for several samples per request before a threshold counts as met.

## Measuring the judge

`recap-judge.test.ts`, in the same folder, scores candidate judge models against labels. It runs with the scenarios.

- `__fixtures__/labels/<id>.json`: for each scenario, what the user asked for and where each request stands at each check, labelled by someone who saw only the script ([the rules](./labelling-rules.md)). `split` is `tune` or `held-out`.
- `../session-recap-judge-questions.ts`: the questions, one per criterion, each with the action it leads to and the share of wrong firings its threshold may allow.
- `recap-judge-state.test-fixture.ts`: what a question is asked about: the request, and the conversation after it as a reader would see it.
- `recap-judge-models.test-fixture.ts`: the candidates, their prices, and how each is asked.
- `__fixtures__/judge-answers/<model>.json`: what a model answered, keyed on a hash of the model and the request. Only Clef's is kept, since only Clef judges; the other candidates' answers are at commit `9704849`, and a candidate with no answers on record is skipped offline. `__fixtures__/judge-thresholds.json`: each model's thresholds, with the hash of the question wording they were set on.

Offline, the suite checks that every scenario is labelled, that no conversation is on both sides of the split, and that the saved answers still give the saved thresholds. A change to a question, to the state or to a model's answers is therefore a new measurement, not a silent change.

### The judge as the recap runs it

The recap runs Clef alone (`@cf/cloudflare/clef`, or the same model as `cloudflare/clef` on OpenRouter), with the thresholds measured for it on the tune split. `RECAP_JUDGE_CALIBRATION` in `../session-recap-judge-questions.ts` pins the model, the hash of the question wording and the five thresholds together; the judge does not run on wording its thresholds were not measured on. There is no second model: when Clef fails or times out the request stays "Open".

Two offline checks run the product's own code against the recorded answers:

- `recap-judge.test.ts`, "the recap judged by its own code": every labelled request goes through the app's transcript readers, the conversation reader (`../session-recap-conversation.ts`), the requests step, the Clef client and the display rule, on every surface a scenario runs on. Each request goes in under the user's own words, as the measurement asked about it. It fails if a finished request or a running turn is ever shown as "Not addressed", if fewer open requests are caught than the measurement caught, or if a reader starts handing the judge a state other than the one measured (the few known differences are listed in the test, with the reason).
- `recap-scenarios.test.ts` now runs the judge inside the whole pipeline. There the request is the text the read step wrote, so its judge requests differ from the measurement's and have their own recordings: `__fixtures__/judge-answers/recap-scenarios.json`, written by a live run. A judge request with no answer on record is answered with a failure, which the recap takes as it takes any judge failure: the request stays "Open". `matrix.json` counts both under `judge` (`answered`, `unrecorded`), so a replay never passes off a missing recording as the judge's opinion.

| Environment                      | Effect                                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `RECAP_JUDGE_LIVE=1`             | Ask each model what is not on record, then write the answers, the thresholds and the report. Same credential.  |
| `RECAP_JUDGE_MODELS=name1,name2` | Only these models, by the last part of their id (`clef`, `clef-flash`, `glm-4.7-flash`, `gemma-4-26b-a4b-it`). |
| `RECAP_JUDGE_MAX_USD=<n>`        | Stop before the first request when the estimate for what must be asked is above this. Default 1.               |
| `RECAP_JUDGE_CONCURRENCY=<n>`    | Requests in flight per model. Default 4.                                                                       |
| `RECAP_JUDGE_REPORT=<dir>`       | Where `report.md` and `calls.jsonl` go. Default `docs/recap-audit/evidence/judge`.                             |

`report.md` gives, per model: AUC per question on each split, each threshold and what it catches and fires on wrongly on the held-out split, the addressed requests it would list as not addressed (by name), cost and latency. `calls.jsonl` has one line per request: the model, the item, whether it came from the cache, tokens, cost, time, or the kind of failure. It is not committed.

### One command, on a host with a credential

```
node config/scripts/session-recap/record-and-measure-recap-models.mjs
```

It checks the credential, records the replies for scenarios that have none, measures Clef (set `RECAP_JUDGE_MODELS` to measure other candidates), removes `pending` from the scenarios it recorded, replays everything with no network, and prints the summary and the files to commit. It can be run again at any point: only what is missing is asked for.

## In the app

Three specs run thirteen of the scenarios in the built app, with the recap panel open, replaying the same recorded replies through the scripted `claude` stub (`recapReplies` in `tests/e2e/helpers/session-services-stub.ts`):

| Spec                                                    | Surface                                            | Needs                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/e2e/session-recap-baseline-chat.spec.ts`         | In-app Claude chat                                 |                                                                                                                                                                                                                         |
| `tests/e2e/session-recap-baseline-external-cli.spec.ts` | Claude and Codex CLI sessions started outside Seal |                                                                                                                                                                                                                         |
| `tests/e2e/session-recap-baseline-remote.spec.ts`       | A Claude CLI session over SSH and on a Seal server | Linux with passwordless sudo (the spec creates accounts and starts its own `sshd` on loopback); for the server test, `ORCA_E2E_ORCAD_CONVERT_TEMPLATE` set to an orcad template built as in `.github/workflows/e2e.yml` |

They are skipped unless asked for:

```
RECAP_E2E=1 RECAP_E2E_EVIDENCE_DIR="$PWD/docs/recap-audit/evidence/e2e" ORCA_BACKGROUND_LAUNCH=1 \
  xvfb-run -a pnpm run test:e2e tests/e2e/session-recap-baseline-chat.spec.ts \
  tests/e2e/session-recap-baseline-external-cli.spec.ts tests/e2e/session-recap-baseline-remote.spec.ts --workers=3
```

The first run builds the app; add `SKIP_BUILD=1` to reuse that build. `xvfb-run` is for Linux machines without a display. A full run takes about ten minutes: the specs' utility model is the `claude` CLI, an agent CLI's turn-end passes stay four minutes apart, and the app has no test clock. The specs wait on that interval by name (`NEXT_AUTOMATIC_PASS_MS` in `tests/e2e/helpers/recap-baseline.ts`).

Each test saves a screenshot of the hidden window and the recap as the app returned it. That folder is not committed. A test for behaviour that is wrong today is marked `test.fail`, so the spec passes while the bug is present and fails once it is fixed; remove the mark then.
