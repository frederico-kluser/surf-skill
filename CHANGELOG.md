# Changelog

## v2.1.0 — Brave Search as 3rd provider + `--mode` flag

### What's new

- **Brave Search added as 3rd provider** (`--provider brave`). Brave runs
  its own index (independent from Google/Bing) and currently offers $5/mo
  in API credit + metered usage (~$0.003/query) after the free tier was
  retired in Feb 2026. Search only — Brave has no extract/crawl/map/
  research equivalents, so the capability map keeps those Tavily-only.
- **New `--mode <fast|normal|slow>` flag** for `search`. Each provider
  translates the mode to its native tier:

  | Mode | Tavily | Parallel | Brave |
  |---|---|---|---|
  | `fast`   | `search_depth=fast` | (ignored) | `count=5` |
  | `normal` | `search_depth=basic` | `/v1/search` | `count=10` |
  | `slow`   | `search_depth=advanced` | (ignored) | `count=20` |

  `--depth basic|advanced` continues to work as a legacy alias for Tavily.

- **Library API gets `opts.mode`, `opts.braveKey`, `opts.braveKeys`**:
  ```js
  await search('claude api', { mode: 'fast', braveKey: 'BS...' });
  ```

- **`BRAVE_API_KEY` / `BRAVE_API_KEYS` env vars** now part of the discovery
  hierarchy (env > .env > ~/.config/surf/keys.json).

- **Setup wizard** now prompts for Brave keys after Tavily + Parallel.

- **State migration is transparent**: existing `~/.config/surf/keys.json`
  files from v2.0.x get a `brave` section added automatically on next
  `loadState()` — no manual upgrade step needed.

### Default chain order

`search` chain is now `[tavily, parallel, brave]`. Existing users see no
behavior change (Tavily still tried first); Brave is the 3rd fallback.
`last_ok_provider` still wins.

### Breaking changes

None. CLI and library APIs are backward compatible.

### Files added

- `src/lib/providers/brave.mjs` — adapter, `mapError()`, `/web/search`
  with mode → count translation.

### Files modified

- `src/lib/providers/index.mjs` — register brave + add to capabilityMap.search
- `src/lib/state.mjs` — `PROVIDERS = ['tavily', 'parallel', 'brave']` +
  `normalizeFullState()` for graceful schema migration
- `src/env.mjs` — `discoverKeys()` returns `{ tavily, parallel, brave }`
- `src/lib/cost.mjs` — `estimateBrave()` returns 1 credit/search
- `src/lib/setup.mjs` — 3-provider wizard
- `src/lib/providers/tavily.mjs` — mode → search_depth resolution
- `src/lib/api/search.mjs` — library opts.mode
- `bin/surf-skill.mjs` — HELP + `--mode` flag wiring
- `src/lib/harness-install.mjs` — skeleton with brave section
- `package.json`, `SKILL.md`, `README.md` — bump 2.0.0 → 2.1.0, doc updates

### Fora de escopo

- Brave `/summarizer/search` endpoint — defer to v2.2 (different rate
  limit, response shape adds `data.answer`).
- Brave Goggles support (`--goggle <id>`) — defer.
- News / Images / Videos / Local / Spellcheck endpoints — defer.

---

## v2.0.0 — npm package, cross-OS install, library mode

### What's new

- **One-liner cross-OS install via npm.** `npm i -g surf-skill` works on
  Linux, macOS, and Windows. Postinstall script creates symlinks into all
  4 supported agent harnesses (Claude Code, OpenCode, Codex CLI, Pi
  Coding Agent), initializes `~/.config/surf/keys.json`, and cleans up
  legacy symlinks from prior versions. Falls back to recursive copy on
  Windows without Developer Mode.
- **Library mode for Node / Next.js / Express.** Import named functions:
  ```js
  import { search, extract, research } from 'surf-skill';
  const r = await search('claude api', { max: 3 });
  ```
  Auto-discovers keys from `opts → process.env → .env → ~/.config/surf/keys.json`
  (each level can contribute; results merged + deduped).
- **Multi-key wizard.** `surf-skill setup` now prompts for N keys per
  provider (Enter empty to finish that provider). Add 1+ Tavily + 1+
  Parallel keys in one pass.
- **Auto-wizard on first TTY use.** Running any command that needs keys
  in a TTY with empty config auto-launches the wizard, then resumes the
  command. CI/non-TTY behavior unchanged (clear actionable error).
- **Batch search in the library too.** `search(['q1', 'q2', 'q3'], opts)`
  returns `{ summary, data: { batches } }` — same shape as CLI batch.

### Breaking changes

- **Distribution moved from `git clone + install.sh` to `npm i -g`.**
  If you installed via the old `install.sh`:
  ```bash
  # Remove old install
  rm -f ~/.local/bin/surf-skill
  rm -rf ~/.agents/skills/surf-skill ~/.claude/skills/surf-skill \
         ~/.codex/skills/surf-skill ~/.pi/agent/skills/surf-skill
  # Install via npm
  npm i -g surf-skill
  # Your ~/.config/surf/keys.json is preserved.
  surf-skill keys list
  ```
- **Repo layout**: `skills/surf-skill/*` moved to root. The package now
  lives directly at the repo root for npm publishing. The `install.sh`
  script is gone (replaced by `src/install/postinstall.mjs`).
- **Package name** unchanged (`surf-skill`).
- **CLI surface unchanged** — all commands, flags, and behavior identical.
- **State location unchanged** — `~/.config/surf/keys.json` and
  `~/.cache/surf/` preserved.

### Files added

- `src/index.mjs` — library entry (named exports)
- `src/env.mjs` — key discovery hierarchy + dotenv loader
- `src/install/postinstall.mjs` — cross-OS postinstall (idempotent)
- `src/install/preuninstall.mjs` — clean up symlinks on `npm rm`
- `src/lib/harness-install.mjs` — `symlinkOrCopy` helper, legacy cleanup
- `src/lib/api/{search,extract,crawl,map,research}.mjs` — library wrappers

### Files modified

- `package.json` — `type: module`, `bin`, `main`, `exports`, `files`,
  `postinstall`/`preuninstall` scripts; version 1.0.0 → 2.0.0
- `bin/surf-skill.mjs` — imports point to `../src/lib/`; VERSION 2.0.0;
  auto-wizard block on first TTY use
- `src/lib/setup.mjs` — multi-key loop (N keys per provider)
- `src/lib/dispatch.mjs` — accepts `runCtx.state` for in-memory library mode
- `README.md` — one-liner install, library section, bonus features
- `SKILL.md` — `metadata.version: "2.0.0"`, npm install in requires

### Files removed

- `skills/surf-skill/install.sh` — replaced by postinstall.mjs
- `skills/` directory — dissolved into root (npm-friendly layout)
- All `CHANGELOG-v2.x.md` (consolidated into this CHANGELOG.md in v1.0.0)

---

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
