# surf-skill v2.1.0

**Per-project bash-timeout config, smarter default search, self-budget guard.**

This minor release closes the gap left by v2.0.0 around agent-side bash
timeouts and improves default search quality.

## Highlights

- **New: `surf-skill project-config`** — auto-detects which agent harness
  the current project uses (via `.github/`, `.claude/`, `.pi/` markers)
  and writes the right per-project config so the bash tool doesn't time
  out:
  - `.github/copilot-hooks.json` → `{ "timeoutSec": 300 }`
  - `.claude/settings.local.json` → raises `BASH_DEFAULT_TIMEOUT_MS` to 300 s
  - `.pi/settings.json` → raises `PI_BASH_DEFAULT_TIMEOUT_SECONDS` to 300
  - Use `--harness <copilot|claude|pi|all>` to force; `--yes` to skip prompts.
- **New: self-budget guard in dispatch** — surf-skill reads the harness's
  bash timeout from env vars (`BASH_DEFAULT_TIMEOUT_MS`,
  `PI_BASH_DEFAULT_TIMEOUT_SECONDS`, `OPENCODE_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS`,
  or `SURF_AGENT_BUDGET_MS` override). When the budget would run out before
  a call can finish, surf-skill aborts early with `LikelyAgentTimeout` and
  a clear instruction to run `surf-skill project-config` — instead of being
  killed silently by SIGTERM. If no env var is detected, the worst-case
  budget of 30 s (Copilot CLI default) is assumed.
- **New: SIGTERM/SIGINT handler** — defense in depth. If the harness still
  kills us before the self-budget guard fires, the handler writes a
  `KilledBySignal` error to stderr with the same mitigation hint before
  exiting 143.
- **Default `search --depth` is now `advanced`** (was `basic`). Better
  quality, still 3–10 s typical. Pass `--depth basic` explicitly when you
  want the cheaper/faster path.
- **Setup wizard** now ends with an instruction to run `surf-skill
  project-config` per project, with a callout for Copilot CLI users.
- **SKILL.md** documents the two new error codes (`LikelyAgentTimeout`,
  `KilledBySignal`) so the agent surfaces them with actionable advice
  instead of retrying blindly.

## Files added / changed

- New: `skills/surf-skill/lib/project-config.mjs` — detection + JSON merge.
- New: `CHANGELOG-v2.1.md`.
- Modified: `skills/surf-skill/bin/surf-skill.mjs` — case `project-config`,
  SIGTERM handler, default depth, VERSION bump.
- Modified: `skills/surf-skill/lib/dispatch.mjs` — `detectHarnessBudgetMs()`,
  `detectHarnessName()`, self-budget check, `LikelyAgentTimeout`.
- Modified: `skills/surf-skill/lib/setup.mjs` — CHEAT_SHEET wraps up with
  `project-config` instructions.
- Modified: `skills/surf-skill/install.sh` — final hint about
  `surf-skill project-config`.
- Modified: `skills/surf-skill/SKILL.md` — version 2.1.0, mandatory rule
  #2 updated, new error codes, project-config recommended.
- Modified: `README.md` — quickstart includes `project-config`, harness
  cards point at it, troubleshooting gains `LikelyAgentTimeout` /
  `KilledBySignal`.
- Modified: `package.json` — version 2.1.0.

## Breaking changes

None. The default `search --depth` change from `basic` → `advanced` is the
only behavior change; callers that rely on the old 1-credit cost can pass
`--depth basic` explicitly.

## Upgrade

```bash
cd <your-clone-of-surf-skill>
git pull
bash skills/surf-skill/install.sh
# then in each project where you use surf-skill:
cd path/to/project
surf-skill project-config
```

## Why GH Copilot CLI is still the most fragile

Copilot CLI has no global bash-timeout config; the only knob is the
per-project `.github/copilot-hooks.json` hook (default `timeoutSec: 30`).
v2.0.0 left this entirely to the user — v2.1.0 makes it a one-command
fix (`surf-skill project-config`) and surfaces a clear error if you
forget.
