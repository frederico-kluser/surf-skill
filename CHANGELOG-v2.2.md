# surf-skill v2.2.0

**Batch search + live progress logs to stderr.**

This minor release makes the skill much friendlier for LLM-driven workflows:
multi-query batches in one call, and a stable stderr stream so the agent
(and the human) can follow what's happening in real time.

## Highlights

- **Batch search.** Pass multiple positional args to `search` and each is
  treated as an independent query:
  ```bash
  surf-skill search "compare X vs Y" "alternatives to X" "X security issues"
  ```
  - Runs **sequentially** (avoids rate-limit thrashing on a single key).
  - Partial failures are reported inline; exits `0` if at least one query
    succeeded, `1` if all failed.
  - Markdown output uses sub-sections per query; `--json` returns a
    `{ summary, data.batches[] }` envelope with per-query latency, provider,
    credits, and any error.
  - One positional arg keeps the previous single-query behavior (backward
    compatible).
- **Progress logs to stderr.** Every operation now emits one self-contained
  line per event:
  ```
  [surf 17:58:12] ▸ search → tavily (key #0)
  [surf 17:58:14] ✓ search tavily 1234ms (2 credits)
  [surf 17:58:14] ↻ tavily 429 — backoff 1500ms (attempt 1/3)
  [surf 17:58:18] ⚠ tavily key #0 burned (401)
  [surf 17:58:20] ⏱ batch done: 3/3 ok, 0 failed (8200ms, 6 credits)
  ```
  - Stdout stays clean (the LLM/pipe still parses JSON or Markdown there).
  - No ANSI animation, no `\r` rewrites — each line is self-contained and
    grep-friendly, so it works equally well in TTY and in agent capture.
  - Stable format documented in SKILL.md so agents can scan stderr for
    `✓`/`✗`/`⚠` lines to understand what happened.
- **New `--quiet` flag** (and `SURF_QUIET=1` env) to silence progress when
  piping into another tool or in CI.

## SKILL.md guidance for the agent

- New mandatory rule (#4 rewritten): batch multi-angle queries in ONE call
  instead of looping N shell calls. Cheaper, faster, easier to follow.
- New "Progress logs" section documenting the line format and symbols so
  the agent knows how to read stderr.

## Files

New:
- `skills/surf-skill/lib/progress.mjs` — stderr event emitter with `--quiet` support.
- `CHANGELOG-v2.2.md`.

Modified:
- `skills/surf-skill/bin/surf-skill.mjs` — batch search (`runSearchBatch`,
  `emitBatchResult`), `--quiet` flag wiring, HELP, VERSION 2.2.0.
- `skills/surf-skill/lib/dispatch.mjs` — progress hooks on attempt/success/
  retry/burn/cache-hit.
- `skills/surf-skill/SKILL.md` — version, batch rule, progress docs.
- `README.md` — quickstart, command table, batch + progress sections, layout.
- `package.json` — version 2.2.0.

## Breaking changes

None. Single-query `surf-skill search "..."` behaves exactly as before.
The new behavior only kicks in when you pass 2+ positional args.

## Upgrade

```bash
cd <your-clone-of-surf-skill>
git pull
bash skills/surf-skill/install.sh
```

No config or state migration is needed.

## Why this matters for LLMs

LLMs are good at deciding what to look up but bad at orchestrating many
shell calls. Before: an agent investigating "X vs Y" might fire 3 separate
`surf-skill search` calls, with no shared progress and no rate-limit
coordination. Now: one batched call with sequential execution, per-query
progress on stderr, and a single Markdown/JSON result that's easy to read
back. The progress lines also turn timeouts and key burns from invisible
failures into actionable events the agent can surface to the user.
