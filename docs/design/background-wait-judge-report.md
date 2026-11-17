# Background wait judge measurement

Model `clef-flash on openrouter`, question book `7d0976546dbd`. 52 labelled cases end with something running, 40 of them answered by the model; 3 more have nothing running and are settled by code without it (check-back-promise-no-process, waiter-finished-nothing-running, build-finished-nothing-running).

The last-turn rule shows a session first: a command still running that was started since the user last spoke is a wait. The model then moves a session to "Waiting on background tasks" when its probability of `waiting` is above **0.5197**, and to "Waiting on you" only when `leftover` is its likeliest standing; any other answer leaves the rule's status. The cut is set on the tune split alone; the held-out row is on cases the wording and the cut never saw. With this few cases one case moves a rate by several points.

**12 cases have no answer on record** and are counted in no rate below: subagent-detached-cache-build-sweep-chained, subagent-detached-job-alone-terse, detached-training-main-thread, named-job-launch-not-read, detached-dev-server-this-turn, detached-sync-from-earlier-turn-answer-done, nohup-job-nothing-else, subagent-detached-benchmark-says-running, named-pid-still-running, detached-eval-beside-old-server, detached-tunnel-left-for-reviewer, detached-backfill-from-earlier-turn-new-fix-done. They are shown by the last-turn rule alone until a live run asks the model about them.

**2 labels were changed after the model had answered**, so those cases are no blind test of it: nohup-job-not-a-child-storybook-up (tune): Was `leftover` (a job outside the agent's commands wakes nobody) when Clef Flash answered. A job started since the user last spoke is now a wait whether or not Claude Code tracks it, so the label follows the rule. nohup-backfill-old-server-up (held-out): Was `leftover` (a job outside the agent's commands wakes nobody) when Clef Flash answered. A job started since the user last spoke is now a wait whether or not Claude Code tracks it, so the label follows the rule.

| split    | AUC of `waiting` | waits shown as waiting | others shown as your turn | shown right | right by the rule alone | likeliest standing is the label | shown wrongly | no answer |
| -------- | ---------------- | ---------------------- | ------------------------- | ----------- | ----------------------- | ------------------------------- | ------------- | --------- |
| tune     | 1.000            | 10 of 10               | 10 of 10                  | 20 of 20    | 16 of 20                | 19 of 20                        | none          | 6         |
| held-out | 1.000            | 11 of 11               | 9 of 9                    | 20 of 20    | 15 of 20                | 20 of 20                        | none          | 6         |

0 requests in this run, 37235 input tokens on record, $0.00141.

| case                                             | split    | label    | by the rule alone | waiting   | leftover | other  | reason               | shown        | right  |
| ------------------------------------------------ | -------- | -------- | ----------------- | --------- | -------- | ------ | -------------------- | ------------ | ------ |
| until-pgrep-waiter-says-still-running            | tune     | waiting  | waiting-task      | 0.8852    | 0.0732   | 0.0416 | says_waiting         | waiting-task | yes    |
| sleep-then-check-ci                              | tune     | waiting  | waiting-task      | 0.8079    | 0.1299   | 0.0622 | command_waits        | waiting-task | yes    |
| pytest-in-background-terse                       | tune     | waiting  | waiting-task      | 0.8756    | 0.0840   | 0.0404 | says_waiting         | waiting-task | yes    |
| waiter-says-nothing                              | tune     | waiting  | waiting-task      | 0.8693    | 0.0753   | 0.0554 | command_waits        | waiting-task | yes    |
| monitor-until-rollout-healthy                    | tune     | waiting  | waiting-task      | 0.8472    | 0.1041   | 0.0487 | says_waiting         | waiting-task | yes    |
| docker-build-then-continue                       | tune     | waiting  | waiting-task      | 0.9012    | 0.0674   | 0.0314 | says_waiting         | waiting-task | yes    |
| waiter-beside-old-dev-server                     | tune     | waiting  | waiting-task      | 0.8364    | 0.1171   | 0.0465 | says_waiting         | waiting-task | yes    |
| wait-for-health-then-smoke                       | tune     | waiting  | waiting-task      | 0.8605    | 0.0876   | 0.0519 | command_waits        | waiting-task | yes    |
| second-reviewer-in-background                    | tune     | waiting  | waiting-task      | 0.8443    | 0.0965   | 0.0592 | says_waiting         | waiting-task | yes    |
| old-dev-server-button-renamed                    | tune     | leftover | your-turn         | 0.1616    | 0.7110   | 0.1274 | work_reported_done   | your-turn    | yes    |
| dev-server-started-this-turn                     | tune     | leftover | waiting-task      | 0.1787    | 0.7125   | 0.1088 | serves_the_user      | your-turn    | yes    |
| old-log-tail-fix-done                            | tune     | leftover | your-turn         | 0.2691    | 0.6150   | 0.1159 | command_waits        | your-turn    | yes    |
| check-back-promise-with-only-a-server            | tune     | leftover | your-turn         | 0.2160    | 0.6925   | 0.0915 | nothing_waits_for_it | your-turn    | yes    |
| nohup-job-not-a-child-storybook-up               | tune     | waiting  | your-turn         | 0.7278    | 0.2057   | 0.0665 | says_waiting         | waiting-task | yes    |
| build-finished-old-server-still-up               | tune     | leftover | your-turn         | 0.1318    | 0.7705   | 0.0977 | work_reported_done   | your-turn    | yes    |
| test-database-left-up                            | tune     | leftover | waiting-task      | 0.3116    | 0.5683   | 0.1201 | work_reported_done   | your-turn    | yes    |
| watch-mode-left-on-purpose                       | tune     | leftover | waiting-task      | 0.2727    | 0.6569   | 0.0704 | serves_the_user      | your-turn    | yes    |
| old-monitor-on-access-log                        | tune     | leftover | your-turn         | 0.2033    | 0.6827   | 0.1140 | serves_the_user      | your-turn    | yes    |
| jupyter-from-earlier                             | tune     | leftover | your-turn         | 0.1515    | 0.7486   | 0.0999 | work_reported_done   | your-turn    | yes    |
| unread-command-message-unrelated                 | tune     | other    | your-turn         | 0.1809    | 0.4208   | 0.3983 | work_reported_done   | your-turn    | yes    |
| subagent-detached-cache-build-sweep-chained      | tune     | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| subagent-detached-job-alone-terse                | tune     | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| detached-training-main-thread                    | tune     | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| named-job-launch-not-read                        | tune     | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| detached-dev-server-this-turn                    | tune     | leftover | waiting-task      | not asked |          |        |                      | waiting-task | **no** |
| detached-sync-from-earlier-turn-answer-done      | tune     | leftover | your-turn         | not asked |          |        |                      | your-turn    | yes    |
| gh-run-watch                                     | held-out | waiting  | waiting-task      | 0.8861    | 0.0788   | 0.0351 | says_waiting         | waiting-task | yes    |
| cargo-build-release                              | held-out | waiting  | waiting-task      | 0.8984    | 0.0677   | 0.0339 | says_waiting         | waiting-task | yes    |
| earlier-turn-training-still-reported             | held-out | waiting  | your-turn         | 0.8507    | 0.1053   | 0.0440 | says_waiting         | waiting-task | yes    |
| unread-command-says-waiting                      | held-out | waiting  | your-turn         | 0.6277    | 0.1970   | 0.1753 | says_waiting         | waiting-task | yes    |
| download-then-convert                            | held-out | waiting  | waiting-task      | 0.8530    | 0.1010   | 0.0460 | says_waiting         | waiting-task | yes    |
| tests-while-you-review                           | held-out | waiting  | waiting-task      | 0.9023    | 0.0562   | 0.0415 | says_waiting         | waiting-task | yes    |
| flag-file-waiter-hours-later                     | held-out | waiting  | waiting-task      | 0.9006    | 0.0619   | 0.0375 | command_waits        | waiting-task | yes    |
| terraform-apply                                  | held-out | waiting  | waiting-task      | 0.8738    | 0.0828   | 0.0434 | says_waiting         | waiting-task | yes    |
| kubectl-rollout-status-terse                     | held-out | waiting  | waiting-task      | 0.8028    | 0.1367   | 0.0605 | command_waits        | waiting-task | yes    |
| file-waiter-says-nothing                         | held-out | waiting  | waiting-task      | 0.7691    | 0.1370   | 0.0939 | command_waits        | waiting-task | yes    |
| old-typecheck-watch                              | held-out | leftover | your-turn         | 0.2756    | 0.6114   | 0.1130 | serves_the_user      | your-turn    | yes    |
| log-tail-left-for-the-user                       | held-out | leftover | waiting-task      | 0.1211    | 0.8007   | 0.0782 | serves_the_user      | your-turn    | yes    |
| old-docker-compose-up                            | held-out | leftover | your-turn         | 0.2759    | 0.6139   | 0.1102 | work_reported_done   | your-turn    | yes    |
| tell-me-when-with-old-tunnel                     | held-out | leftover | your-turn         | 0.1479    | 0.7672   | 0.0849 | nothing_waits_for_it | your-turn    | yes    |
| waiter-finished-old-watcher-up                   | held-out | leftover | your-turn         | 0.3819    | 0.5438   | 0.0743 | command_waits        | your-turn    | yes    |
| preview-server-this-turn                         | held-out | leftover | waiting-task      | 0.1592    | 0.7652   | 0.0756 | serves_the_user      | your-turn    | yes    |
| old-ssh-tunnel                                   | held-out | leftover | your-turn         | 0.1357    | 0.7267   | 0.1376 | serves_the_user      | your-turn    | yes    |
| periodic-sync-loop-from-earlier                  | held-out | leftover | your-turn         | 0.3285    | 0.5289   | 0.1426 | command_waits        | your-turn    | yes    |
| nohup-backfill-old-server-up                     | held-out | waiting  | your-turn         | 0.7136    | 0.2406   | 0.0458 | command_is_the_work  | waiting-task | yes    |
| unread-command-nothing-said                      | held-out | other    | your-turn         | 0.1181    | 0.1869   | 0.6950 | says_waiting         | your-turn    | yes    |
| nohup-job-nothing-else                           | held-out | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| subagent-detached-benchmark-says-running         | held-out | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| named-pid-still-running                          | held-out | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| detached-eval-beside-old-server                  | held-out | waiting  | waiting-task      | not asked |          |        |                      | waiting-task | yes    |
| detached-tunnel-left-for-reviewer                | held-out | leftover | waiting-task      | not asked |          |        |                      | waiting-task | **no** |
| detached-backfill-from-earlier-turn-new-fix-done | held-out | leftover | your-turn         | not asked |          |        |                      | your-turn    | yes    |
