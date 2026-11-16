# Labelling rules for the recap scenarios

Every scenario in `src/main/session-recap/scenarios/__fixtures__/scenarios/` has a file of the same name in `__fixtures__/labels/`. It says what the user asked for and where each request stands at each of the scenario's checks. These labels are the ground truth the judge models are scored against ([how](./README.md#measuring-the-judge)).

The labels encode a policy. Where the product's policy changes, change the rule here first and relabel what it touches: a label that contradicts the policy teaches a threshold the wrong line.

## Who labels

Someone who has not seen the scenario's checks, the recorded model replies, the baseline or the design. The labeller reads the scenario as a script of what was said and done, and nothing else. Steps about the recap itself (opening it, refreshing it, marking an entry, a restart, the recap model failing) are not part of what was asked or done.

The first 79 scenarios were labelled by model instances that were given only the scripts and these rules. A second instance labelled 35 of them independently and agreed on all 101 labels. Both read the same rules, so that agreement shows the rules are unambiguous on those scripts; it does not replace a person reading the labels.

## What a request is

Something the user asks the agent to do, change, find out or answer.

- One entry per distinct request, even when one message holds several.
- A reminder or a second asking of the same thing is the same request. Its words are added as another quote.
- Not requests: an answer to the agent's question that asks for nothing new, thanks, a remark, agreeing to what the agent proposed. These go under `notRequests`.
- A rule for the whole session ("never touch generated/") has no outcome. It goes under `rules`.
- Text the harness inserted and compaction summaries are not the user's words.

Each quote is copied exactly from one user message: the shortest run of the user's own words that states the request. The first quote is where the request was first made.

## Where a request stands

Judged only from what was said and done before the check. Exactly one of:

| `is`        | Means                                                                                                                                                                                                                            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `working`   | The agent's turn that follows the request has not ended: the status is `working` or `waiting-subagent`, or the agent has started and written no closing message.                                                                 |
| `done`      | The agent did all of it. It says so, or its edits, commands or subagent visibly did it, or (for a question) it answered.                                                                                                         |
| `partly`    | The agent did a real part and left a part undone, and the part left can be named.                                                                                                                                                |
| `declined`  | The agent refused it or advised against it, gave a reason, and did not do it.                                                                                                                                                    |
| `withdrawn` | The user took it back, said to drop or skip it, or replaced it with a different request.                                                                                                                                         |
| `open`      | None of the above. The turn ended and the request was not done, declined or withdrawn. This includes: the agent never mentioned it; the agent said it will do it later; the agent asked the user something first and is waiting. |

Later events win. Declined and then done after the user insists is `done`. Withdrawn and then asked for again is `open` until it is done. Done and then the user says it does not work is `open`. Done and then the user asks about it, or mentions it, is still `done`.

Each label has a `why`: one sentence naming the step that decides it.

## Where the rules had to choose

The design does not settle these. The labels follow the choice in the right-hand column; if the design decides otherwise, relabel.

| Case                                                                        | Labelled as                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A compound ask where one half is done ("rename the column and backfill it") | One request, `partly`. Two requests only when the user states them as separate things.       |
| The agent declines and offers something else, and the user takes the offer  | The original is `withdrawn`; the offer is a new request.                                     |
| Part is done and the rest waits on the user's answer                        | `partly`.                                                                                    |
| Nothing is done and the agent waits on the user's answer                    | `open`.                                                                                      |
| The user says "don't touch X" while the agent is working on X               | The request for X is `withdrawn`. It is a rule only when it is stated for the whole session. |

## Splits

`split` is `tune` or `held-out`. Wording and thresholds are set on `tune`; results are reported on `held-out`.

- Scenarios are grouped by the rarest standing they reach, in the order withdrawn, declined, partly, working, open, done. Each group is divided about three to two.
- Scenarios that open with the same user message tell one story under different conditions. They stay in one split, so no conversation is on both sides.
- The suite fails when a group is missing from a split, or when one conversation and request appears in both.

A new scenario needs a labels file before the suite passes. Put it in the split that keeps its group closest to three to two.
