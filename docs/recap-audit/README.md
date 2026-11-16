# Session recap audit

An audit of the session recap on `seal/all` at 7a6dc74d5d2, a baseline of how it behaves before any fix, and a design for its overhaul. No product code is changed here.

|                                                      |                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [01-pipeline-audit.md](./01-pipeline-audit.md)       | How the recap works today, with file and line references, and every bug and weakness found (F1 to F26).       |
| [02-scenario-baseline.md](./02-scenario-baseline.md) | What was tested, how, and the results: 135 pipeline runs, model variance on 258 samples, and the in-app runs. |
| [03-overhaul-design.md](./03-overhaul-design.md)     | The proposed design, the builder workstreams and the decisions to make.                                       |
| [evidence/](./evidence/)                             | The full matrix, the model samples, and screenshots and recap JSON from the app.                              |

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

| Environment                         | Effect                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| (none)                              | Replay. Fails on a request with no recorded reply, and on any difference from `baseline.json`.                              |
| `RECAP_SCENARIOS_ONLY=id1,id2`      | Run only these scenarios.                                                                                                   |
| `RECAP_SCENARIOS_REPORT=<dir>`      | Also write `matrix.json` and `matrix.md` there: expected, actual and result for every run.                                  |
| `RECAP_SCENARIOS_UPDATE_BASELINE=1` | Rewrite `baseline.json` from this run. Review the diff: it should only shrink.                                              |
| `RECAP_SCENARIOS_LIVE=1`            | Ask the real model for anything not recorded and save the reply. Reads `~/.config/seal/cloudflare-ai.json`.                 |
| `RECAP_SCENARIOS_PENDING=<file>`    | Without a credential: write the unanswered requests to this file instead of failing.                                        |
| `RECAP_SCENARIOS_REPLIES=<file>`    | With the above: file replies to those requests (`[{ "contentHash", "model", "reply" }]`) into the cassettes before running. |

### After changing the prompt or a scenario

A changed prompt changes every request, so every recording is stale.

1. Delete the cassettes for the scenarios affected (all of them for a prompt change).
2. `RECAP_SCENARIOS_LIVE=1 pnpm test src/main/session-recap/scenarios --maxWorkers=1`. Without a credential, use the pending and replies files instead and repeat until the pending file is empty: a later request depends on the reply to the earlier one.
3. `RECAP_SCENARIOS_REPORT=docs/recap-audit/evidence RECAP_SCENARIOS_UPDATE_BASELINE=1 pnpm test src/main/session-recap/scenarios`, then `pnpm exec oxfmt --write src/main/session-recap/scenarios/__fixtures__ docs/recap-audit/evidence/matrix.json`.
4. Read the diff of `baseline.json` and `matrix.md`.

A recording is one sample of a model that varies. [The baseline](./02-scenario-baseline.md#how-much-the-model-varies) measures how much; the design asks for several samples per request before a threshold counts as met.

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

The first run builds the app; add `SKIP_BUILD=1` to reuse that build. `xvfb-run` is for Linux machines without a display. A full run takes about ten minutes: the scheduler leaves four minutes between two automatic passes and the app has no test clock.

Each test saves a screenshot of the hidden window and the recap as the app returned it. After a run that rewrites the evidence, format it before committing: `pnpm exec oxfmt --write docs/recap-audit/evidence`. A test for behaviour that is wrong today is marked `test.fail`, so the spec passes while the bug is present and fails once it is fixed; remove the mark then.
