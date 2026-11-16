# Recap judge measurement

Question book `ba879810db9d`. 214 labelled requests-at-a-check from 79 scenarios: 71 done (tune), 71 done (held-out), 13 open (held-out), 17 open (tune), 7 withdrawn (tune), 3 declined (tune), 4 declined (held-out), 5 withdrawn (held-out), 8 working (held-out), 5 working (tune), 4 partly (held-out), 6 partly (tune).

Thresholds are set on the tune split; every "held out" number is on scenarios the thresholds never saw. The suite over-samples hard cases and is not weighted to real sessions, so rates here are for the suite. With this few items in a class, one item moves a rate by several points.

| Model                         | Answered | AUC held out: done / did_part / declined / withdrawn / left_undone | Must-keep lost | Not addressed, caught (held out) | Cost    | Median ms | p95 ms |
| ----------------------------- | -------- | ------------------------------------------------------------------ | -------------- | -------------------------------- | ------- | --------- | ------ |
| @cf/cloudflare/clef           | 214/214  | 0.99 / 0.98 / 1.00 / 1.00 / 1.00                                   | 0              | 13/13                            | $0.0463 | 314       | 758    |
| @cf/cloudflare/clef-flash     | 214/214  | 0.97 / 0.92 / 1.00 / 1.00 / 0.98                                   | 0              | 10/13                            | $0.0073 | 329       | 676    |
| @cf/zai-org/glm-4.7-flash     | 214/214  | 0.81 / 0.76 / 0.98 / 0.60 / 0.67                                   | 0              | 0/13                             | $0.0128 | 1423      | 3467   |
| @cf/google/gemma-4-26b-a4b-it | 214/214  | 0.94 / 0.90 / 0.98 / 0.99 / 0.93                                   | 0              | 0/13                             | $0.0199 | 1581      | 4590   |

## @cf/cloudflare/clef

- Items: 104 tune, 97 held out, 13 mid-turn; 0 without a usable answer (shown as "open").
- Calls: 214 asked, 0 from the cache, failed: none.
- Cost: $0.0463 for 192752 input and 0 output tokens.
- Latency: median 314 ms, p95 758 ms over 214 calls.
- **Must-keep lost** (done, would be listed as not addressed): none
- Other false alarms (partly, declined or withdrawn, would be listed): none
- Listed mid-turn if the host took the turn for over: `many-asks-in-one-long-turn#3@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#4@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#5@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#5@eight minutes into the turn (held-out)`, `many-asks-in-one-long-turn#6@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#6@eight minutes into the turn (held-out)`, `mid-turn-refresh#2@mid-turn (tune)`, `second-ask-sent-while-the-agent-works#2@right after the second message (held-out)`, `subagent-still-running-when-the-agent-stops#2@while the subagent runs (tune)`

| Question      | Yes means | Positives tune / held out | AUC tune | AUC held out | Fires above | Catches (held out) | Fires wrongly (held out) | Broken |
| ------------- | --------- | ------------------------- | -------- | ------------ | ----------- | ------------------ | ------------------------ | ------ |
| `done`        | done      | 71 / 71                   | 1.00     | 0.99         | 0.38        | 61/71              | 0/26                     |        |
| `did_part`    | partly    | 6 / 4                     | 1.00     | 0.98         | 0.95        | 2/4                | 0/93                     |        |
| `declined`    | declined  | 3 / 4                     | 0.99     | 1.00         | 0.93        | 4/4                | 0/93                     |        |
| `withdrawn`   | withdrawn | 7 / 5                     | 1.00     | 1.00         | 0.29        | 5/5                | 0/92                     |        |
| `left_undone` | open      | 17 / 13                   | 1.00     | 1.00         | 0.57        | 13/13              | 0/84                     |        |

Held-out requests by how they stand (rows) and what the recap would show (columns):

|           | addressed | partly | declined | withdrawn | not-addressed | open |
| --------- | --------- | ------ | -------- | --------- | ------------- | ---- |
| done      | 61        | 0      | 0        | 0         | 0             | 10   |
| partly    | 0         | 2      | 0        | 0         | 0             | 2    |
| declined  | 0         | 0      | 4        | 0         | 0             | 0    |
| withdrawn | 0         | 0      | 0        | 5         | 0             | 0    |
| open      | 0         | 0      | 0        | 0         | 13            | 0    |

## @cf/cloudflare/clef-flash

- Items: 104 tune, 97 held out, 13 mid-turn; 0 without a usable answer (shown as "open").
- Calls: 214 asked, 0 from the cache, failed: none.
- Cost: $0.0073 for 192752 input and 0 output tokens.
- Latency: median 329 ms, p95 676 ms over 214 calls.
- **Must-keep lost** (done, would be listed as not addressed): none
- Other false alarms (partly, declined or withdrawn, would be listed): `withdrawn-because-someone-else-does-it#2@after turn 2 (held-out)`
- Listed mid-turn if the host took the turn for over: `many-asks-in-one-long-turn#4@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#5@four minutes into the turn (held-out)`, `many-asks-in-one-long-turn#6@four minutes into the turn (held-out)`

| Question      | Yes means | Positives tune / held out | AUC tune | AUC held out | Fires above | Catches (held out) | Fires wrongly (held out) | Broken |
| ------------- | --------- | ------------------------- | -------- | ------------ | ----------- | ------------------ | ------------------------ | ------ |
| `done`        | done      | 71 / 71                   | 0.99     | 0.97         | 0.37        | 66/71              | 2/26                     |        |
| `did_part`    | partly    | 6 / 4                     | 1.00     | 0.92         | 0.93        | 2/4                | 4/93                     |        |
| `declined`    | declined  | 3 / 4                     | 1.00     | 1.00         | 0.72        | 4/4                | 3/93                     |        |
| `withdrawn`   | withdrawn | 7 / 5                     | 1.00     | 1.00         | 0.47        | 2/5                | 0/92                     |        |
| `left_undone` | open      | 17 / 13                   | 0.99     | 0.98         | 0.77        | 10/13              | 2/84                     |        |

Held-out requests by how they stand (rows) and what the recap would show (columns):

|           | addressed | partly | declined | withdrawn | not-addressed | open |
| --------- | --------- | ------ | -------- | --------- | ------------- | ---- |
| done      | 66        | 1      | 0        | 0         | 0             | 4    |
| partly    | 1         | 1      | 1        | 0         | 0             | 1    |
| declined  | 0         | 0      | 4        | 0         | 0             | 0    |
| withdrawn | 0         | 0      | 1        | 2         | 1             | 1    |
| open      | 1         | 3      | 1        | 0         | 7             | 1    |

## @cf/zai-org/glm-4.7-flash

- Items: 104 tune, 97 held out, 13 mid-turn; 0 without a usable answer (shown as "open").
- Calls: 214 asked, 0 from the cache, failed: none.
- Cost: $0.0128 for 148660 input and 9803 output tokens.
- Latency: median 1423 ms, p95 3467 ms over 214 calls.
- **Must-keep lost** (done, would be listed as not addressed): none
- Other false alarms (partly, declined or withdrawn, would be listed): none
- Listed mid-turn if the host took the turn for over: none

| Question      | Yes means | Positives tune / held out | AUC tune | AUC held out | Fires above | Catches (held out) | Fires wrongly (held out) | Broken |
| ------------- | --------- | ------------------------- | -------- | ------------ | ----------- | ------------------ | ------------------------ | ------ |
| `done`        | done      | 71 / 71                   | 0.86     | 0.81         | 1.00        | 0/71               | 0/26                     |        |
| `did_part`    | partly    | 6 / 4                     | 0.84     | 0.76         | 1.00        | 0/4                | 0/93                     |        |
| `declined`    | declined  | 3 / 4                     | 0.98     | 0.98         | 1.00        | 0/4                | 0/93                     |        |
| `withdrawn`   | withdrawn | 7 / 5                     | 0.78     | 0.60         | 0.00        | 1/5                | 1/92                     |        |
| `left_undone` | open      | 17 / 13                   | 0.80     | 0.67         | 1.00        | 0/13               | 0/84                     |        |

Held-out requests by how they stand (rows) and what the recap would show (columns):

|           | addressed | partly | declined | withdrawn | not-addressed | open |
| --------- | --------- | ------ | -------- | --------- | ------------- | ---- |
| done      | 0         | 0      | 0        | 1         | 0             | 70   |
| partly    | 0         | 0      | 0        | 0         | 0             | 4    |
| declined  | 0         | 0      | 0        | 0         | 0             | 4    |
| withdrawn | 0         | 0      | 0        | 1         | 0             | 4    |
| open      | 0         | 0      | 0        | 0         | 0             | 13   |

## @cf/google/gemma-4-26b-a4b-it

- Items: 104 tune, 97 held out, 13 mid-turn; 0 without a usable answer (shown as "open").
- Calls: 214 asked, 1 from the cache, failed: unusable-reply ×1.
- Cost: $0.0199 for 162339 input and 12184 output tokens.
- Latency: median 1581 ms, p95 4590 ms over 214 calls.
- **Must-keep lost** (done, would be listed as not addressed): none
- Other false alarms (partly, declined or withdrawn, would be listed): none
- Listed mid-turn if the host took the turn for over: none

| Question      | Yes means | Positives tune / held out | AUC tune | AUC held out | Fires above | Catches (held out) | Fires wrongly (held out) | Broken |
| ------------- | --------- | ------------------------- | -------- | ------------ | ----------- | ------------------ | ------------------------ | ------ |
| `done`        | done      | 71 / 71                   | 0.96     | 0.94         | 1.00        | 0/71               | 0/26                     |        |
| `did_part`    | partly    | 6 / 4                     | 0.94     | 0.90         | 1.00        | 0/4                | 0/93                     |        |
| `declined`    | declined  | 3 / 4                     | 0.98     | 0.98         | 1.00        | 0/4                | 0/93                     |        |
| `withdrawn`   | withdrawn | 7 / 5                     | 1.00     | 0.99         | 0.00        | 5/5                | 1/92                     |        |
| `left_undone` | open      | 17 / 13                   | 0.94     | 0.93         | 1.00        | 0/13               | 0/84                     |        |

Held-out requests by how they stand (rows) and what the recap would show (columns):

|           | addressed | partly | declined | withdrawn | not-addressed | open |
| --------- | --------- | ------ | -------- | --------- | ------------- | ---- |
| done      | 0         | 0      | 0        | 1         | 0             | 70   |
| partly    | 0         | 0      | 0        | 0         | 0             | 4    |
| declined  | 0         | 0      | 0        | 0         | 0             | 4    |
| withdrawn | 0         | 0      | 0        | 5         | 0             | 0    |
| open      | 0         | 0      | 0        | 0         | 0             | 13   |
