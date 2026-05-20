# surf-skill v2.0.0

The skill formerly known as `tavily-skill` is now a **multi-provider web
connector** for AI coding agents.

## Highlights

- **One CLI, two providers.** `surf-skill` fronts both **Tavily** and
  **Parallel AI**. The agent never picks the provider — `surf-skill`
  does it, based on a capability map per operation.
- **Multi-key rotation per provider.** Add as many keys as you want; on
  `401`/`403`/`402` or persistent `5xx`, the key is burned and the next
  one is tried automatically. Burned keys auto-reset on the first day of
  the next calendar month.
- **Provider fallback.** If every key for the preferred provider is
  burned, `surf-skill` falls over to the other provider for
  capability-compatible operations (search, extract, research). `crawl`
  and `map` remain Tavily-only by design — Parallel doesn't offer them.
- **Hot-path memory.** The last successful provider/key is persisted in
  `~/.config/surf/keys.json` so the next call starts on the hot path.
- **Predictable output.** `--json` returns the same normalized envelope
  shape across providers. `--raw-json` exposes the raw provider response
  for debugging.

## New commands

- `surf-skill setup` — interactive onboarding wizard (TTY required).
- `surf-skill keys <add|remove|list|reset|clear>` — manage keys.
- `--provider <name>` and `--no-fallback` — force/pin a specific
  provider for debugging.
- `--raw-json` — bypass the normalization layer.

## Breaking changes vs `tavily-skill` v1.x

- **CLI binary**: `tvly` → `surf-skill`.
- **Skill slug**: `tavily` → `surf-skill`. Symlinks moved from
  `~/.agents/skills/tavily/` (and the three per-harness paths) to
  `~/.agents/skills/surf-skill/`.
- **Env vars no longer read at runtime**. `TAVILY_API_KEY` is imported
  into `~/.config/surf/keys.json` on first install, then ignored. The
  installer asks you to remove the env var from your shell rc.
- **Repository**: renamed from `tavily-skill` to `surf-skill` on GitHub.
  Existing clones keep working (GitHub maintains an automatic redirect).

## Per-harness setup

The installer now configures bash timeouts for every harness it can:

| Harness | What changed |
|---|---|
| **Claude Code** | `~/.claude/settings.json` gets `BASH_DEFAULT_TIMEOUT_MS=300000`, `BASH_MAX_TIMEOUT_MS=600000`. |
| **Pi Coding Agent** | `~/.pi/agent/settings.json` gets `PI_BASH_DEFAULT_TIMEOUT_SECONDS=300`, `PI_BASH_MAX_TIMEOUT_SECONDS=600`. |
| **OpenCode** | `~/.config/opencode/opencode.json` gets `mcp_timeout: 600000` and `bash.timeout_ms: 600000`. |
| **GH Copilot CLI** | Cannot be configured globally. Installer prints instructions for adding `.github/copilot-hooks.json` per project. |

## Why GH Copilot CLI is the most fragile

Copilot CLI's default bash timeout is **30 s**, vs 120 s on Claude Code
and Pi. That covers `surf-skill --help`, `--version`, `keys *`, and
`search --max 1` only. For any longer operation, you must add
`.github/copilot-hooks.json` with `{ "timeoutSec": 300 }` to the project
root. The SKILL.md guides the agent to surface this requirement to the
user.

## Upgrading from v1.x

```bash
cd <your-clone-of-this-repo>
git pull
bash skills/surf-skill/install.sh
# Installer removes legacy ~/.agents/skills/tavily/ and ~/.local/bin/tvly
# symlinks, then sets up the new layout. Your keys (if any) in
# ~/.config/surf/keys.json are preserved.
```

If your scripts referenced the old `tvly` command, replace it with
`surf-skill`.

## Architecture

Modular under `skills/surf-skill/lib/`:

- `state.mjs` — atomic JSON I/O for `~/.config/surf/keys.json`, lockfile,
  monthly auto-reset of burned keys.
- `cache.mjs` — TTL response cache under `~/.cache/surf/`.
- `audit.mjs` — JSONL audit + usage logs (per-provider).
- `dispatch.mjs` — the fallback engine; classifies errors, picks
  providers, persists `last_ok_provider`.
- `providers/{tavily,parallel}.mjs` — HTTP adapters; each `mapError()`
  classifies HTTP statuses into `auth`/`rate_limit_429`/`server_5xx`/
  `caller_4xx`/`network`/`not_supported`.
- `format.mjs` — markdown formatters that consume the normalized envelope.
- `keys-cmd.mjs`, `setup.mjs` — onboarding and key management surfaces.

Total runtime dependencies: **zero**. Node 18+ standard library only.
