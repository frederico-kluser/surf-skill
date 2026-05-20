# Changelog

## v1.0.0 — Initial release

`surf-skill` is a multi-provider web skill for AI coding agents that fronts
**Tavily** and **Parallel AI** behind a single bash CLI. The agent calling
this skill never picks the provider — `surf-skill` does, with automatic
key rotation, provider fallback, and last-known-good persistence.

### Capabilities

| Operation | Tavily | Parallel | Default order |
|---|---|---|---|
| `search` | ✓ | ✓ | tavily → parallel |
| `extract` | ✓ | ✓ | tavily → parallel |
| `crawl` | ✓ | ✗ | tavily only |
| `map` | ✓ | ✗ | tavily only |
| `research-start` / `research` | ✓ | ✓ | parallel → tavily |
| `research-poll` | by `request_id` prefix | by `request_id` prefix | sticky |

### Features

- **Multi-provider fallback.** Tavily ↔ Parallel AI by capability map.
- **Multi-key rotation per provider.** Burn on `401/403/402` or persistent
  `5xx`; burned keys auto-reset on the first day of the next calendar month.
- **Provider chain memory.** `last_ok_provider` persisted in
  `~/.config/surf/keys.json` so the next call starts on the hot path.
- **`--provider <tavily|parallel>`** forces a specific provider (disables
  fallback for that call). `--no-fallback` pins to the default provider.
- **Batch search.** Pass multiple positional args to `search` and each is
  an independent query, run sequentially, with partial failures reported
  inline.
- **Progress logs to stderr.** One self-contained line per event
  (`[surf HH:MM:SS] ▸/✓/✗/↻/⚠/⏱`). Stable format for agent parsing.
  Stdout stays clean for JSON/Markdown. `--quiet` / `SURF_QUIET=1`
  silences.
- **Interactive onboarding.** `surf-skill setup` (TTY) wizard prompts for
  keys and persists to `~/.config/surf/keys.json` (chmod 600). On error,
  TTY users see `→ Run 'surf-skill setup' to configure keys interactively.`
- **Per-project bash-timeout config.** `surf-skill project-config`
  auto-detects the harness via `.github/`, `.claude/`, `.pi/` markers and
  writes the right config to raise the bash timeout. Required for GH
  Copilot CLI (default 30 s), recommended for Claude Code / Pi.
- **Self-budget timeout guard.** Reads the harness bash timeout from env
  vars (`BASH_DEFAULT_TIMEOUT_MS`, `PI_BASH_DEFAULT_TIMEOUT_SECONDS`,
  `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`, or `SURF_AGENT_BUDGET_MS`
  override). Aborts early with `LikelyAgentTimeout` instead of being
  killed silently by SIGTERM. Unknown harness → assume 30 s.
- **SIGTERM / SIGINT handler.** Defense in depth: surfaces a
  `KilledBySignal` message with the same `project-config` hint before
  exit 143.
- **Per-project config writer** detects `.github/`, `.claude/`, `.pi/` and
  writes only what the harness in this project needs.
- **Local response cache** (`~/.cache/surf/`, TTL 6 h) keyed by
  `sha256(operation, args)`; `--no-cache` bypasses; cache survives provider
  fallbacks.
- **Local usage ledger** (`~/.cache/surf/usage.jsonl`) per-provider
  breakdown via `surf-skill cost`.
- **Audit log** (`~/.cache/surf/audit.log`) records provider name and key
  INDEX, never the key itself.
- **Cost guard.** Estimates > 10 credits are blocked unless
  `--confirm-expensive` (or `SURF_ALLOW_EXPENSIVE=1`).
- **Predictable JSON.** `--json` returns a normalized envelope with the
  same shape across providers. `--raw-json` exposes the provider response
  for debugging.

### Default behavior

- `search --depth` defaults to `advanced` (better quality, ~3–10 s,
  2 credits). Pass `--depth basic` for the cheaper/faster path.
- `surf-skill research` is capped at 50 s and refuses `--model pro`/`ultra`
  (use `research-start` + `research-poll` for those).

### Provider notes (verified 2026-05-20 against live APIs)

- **Tavily** `POST /search`: `Authorization: Bearer <key>`. Body accepts
  `query`, `search_depth`, `max_results`, `topic`, `time_range`,
  `include_domains`, `exclude_domains`, `country`, `include_answer`,
  `include_raw_content`, etc.
- **Parallel AI** `POST /v1/search`: `x-api-key: <key>`. Body accepts
  ONLY `{ objective, search_queries }`. Any other field (e.g. `processor`,
  `max_results`) is rejected with `Extra inputs are not permitted`.
  Tavily-only knobs are silently ignored when the call lands on Parallel.
- **Parallel** has no crawl / no URL map / no public usage endpoint.

### Supported harnesses

| Harness | Default bash | Max | Coverage after install |
|---|---|---|---|
| **Claude Code** | 120 s | 600 s (hard) | 300 s default via `~/.claude/settings.json` |
| **Pi Coding Agent** | 120 s | 600 s | 300 s default via `~/.pi/agent/settings.json` |
| **GH Copilot CLI** | **30 s** | not documented | per-project `.github/copilot-hooks.json` (run `surf-skill project-config`) |
| **OpenCode** | varies | 600 s | 600 s default via `~/.config/opencode/opencode.json` |
| **Codex CLI** | n/a | n/a | symlinked under `~/.codex/skills/surf-skill/` |

### Stack

Node ≥ 18, bash, **zero npm dependencies**. The full CLI is under 500 LOC
in `skills/surf-skill/bin/surf-skill.mjs` + `skills/surf-skill/lib/*.mjs`.
