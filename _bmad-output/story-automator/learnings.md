# Story Automator Learnings

## Run: 2026-08-13T10:02:56Z

**Epic:** 2 — gym_os - Epic Breakdown
**Stories:** 2.9, 2.10

### Patterns Observed
- Both stories were pre-existing "documentation-drift" additions (raised via correct-course proposals, never backfilled into `epics.md`) — the parser couldn't resolve them until headers were added. Worth checking `epics.md` coverage before every run when sprint-status has stories the epic file doesn't.
- `monitor-session`'s completion detector consistently misclassified genuinely-finished sessions as `timeout`/`max_polls_exceeded` in this container — the tmux pane was idle at an empty prompt (sometimes with a ghost placeholder like "commit this") but never flipped to `session_state=completed`. Happened on all 6 spawned sessions this run. Source-of-truth verification (sprint-status.yaml + story file `Status:` line + git status) caught every case correctly.
- First `claude --dangerously-skip-permissions` invocation in a fresh environment shows a one-time interactive "Bypass Permissions mode" confirmation dialog that blocks the session until answered (Down + Enter). Only happened on the very first spawn of the run.
- `tmux` was not installed in this container; needed `sudo apt-get install -y tmux` before any session could spawn.

### Code Review Insights
- 2.9: 1 High (module-scope `throw` in a statically-imported provider would have crashed the entire OTP hook, not just the new provider — violates "never throw" contract for chain members) + 1 Medium (File List doc-sync gap).
- 2.10: 1 Medium only (File List/Change Log omitted real, git-confirmed work — a new Vitest test runner + CI step). No High/Critical either cycle — both stories passed review on cycle 1.
- Common thread: both findings were about the story file's File List/Change Log falling out of sync with what was actually built, not functional bugs.

### Timing Estimates
- create-story: ~32 min (2.10, cold start — heavy context-gathering across 2.9, correct-course proposals, ARCHITECTURE-SPINE)
- dev-story: ~18 min (2.10; includes one live escalation for real WhatsApp verification)
- automate: ~7-37 min (2.9 was fast/pre-existing groundwork; 2.10 stood up a whole new Vitest+CI setup)
- code-review: ~6-45 min per cycle, both stories clean on cycle 1

### Recommendations for Future Runs
- Treat `monitor-session` timeouts as inconclusive, not failures, in this environment — always verify via sprint-status.yaml/story file before retrying or escalating.
- When staging commits, never rely on `commit-story`'s default `git add -A` in this repo — there are persistent unrelated untracked files (`.claude/settings.json`, `__pycache__/`, a stray PDF Zone.Identifier, an old readiness report) that should not be swept into story commits.
- Consider re-running Epic 2's retrospective now that 2.9/2.10 exist (it was marked done before they were added) — flagged to user, not auto-triggered.
