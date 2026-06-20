# Changelog

## v4.2.0 — parallel fan-out, two new skills, and the Pi no-limit stance

Adds a real **parallel search** path and two skills tuned for it, and corrects
the project's stance on **Pi Coding Agent timeouts**.

### Added

- **`surf-search-skill search-parallel`** — fan out MANY searches concurrently
  through a zero-dep, bounded-concurrency worker pool (`src/lib/pool.mjs`:
  N workers drain a shared cursor; each task is try/caught so one failure never
  kills a worker — the p-limit + `Promise.allSettled` pattern). Flags:
  `--concurrency <n>` (default 6, cap 16), `--queries-file <F.json>` (JSON array
  of strings or `{q,id,sub}` objects, or a newline list). Output groups by
  sub-question. Partial-failure tolerant: a 429 rotates keys/backs off inside
  the call; the command exits non-zero only when EVERY query failed. State is
  loaded once and shared across workers (per-call persistence suppressed, then
  persisted once) so burned keys are visible immediately and there is no
  lockfile thrash.
- **`extract --urls-file <F.json>`** — read URLs from a JSON array
  (`["u", {"url":"u"}]`) or newline list, in addition to positional URLs.
- **`searchParallel(queries, opts)`** library export (`opts.concurrency`,
  `opts.noBudget` default true for library callers).
- **`--no-budget` flag / `SURF_NO_TIMEOUT=1` / `SURF_AGENT_BUDGET_MS=0`** —
  disables the self-budget abort and lets each request use the provider's own
  per-request ceiling (`SURF_TIMEOUT_MS` || 45 s) instead of the detected
  harness bash timeout. For no-limit harnesses only (e.g. Pi core).
- **`surf-parallel-skill`** (new skill) — maximum-information parallel research:
  decompose → diverse queries per sub-question → `search-parallel` fan-out →
  extract top hits → dedupe → cited synthesis, behind a **fan-out gate** (no
  sub-question silently dropped). Triggers narrowed to broad/deep intent so it
  does not collide with `surf-search-skill` on simple lookups.
- **`surf-deep-plan-skill`** (new skill) — ambiguity-exhaustive, research-grounded
  planning: a mandatory **ambiguity sweep** (taxonomy + EARS gap test +
  two-implementations divergence test) and a **two-lock gate** (ambiguity lock +
  research lock) on top of the existing plan workflow. Triggers narrowed to
  "raise all doubts first" / "levante todas as dúvidas" so it does not collide
  with `surf-plan-skill`, which it cross-references for routine plans.

### Changed

- **Pi no-limit stance (reconciled across README, root `SKILL.md`,
  `project-config`).** Pi *core* applies **no** bash timeout; the previous docs
  treated it as 120 s/600 s. The `PI_BASH_*` env vars only bind the optional
  `pi-bash-timeout` extension (where `project-config` raises its cap to
  300 s/600 s). surf can't detect Pi from the environment, so it still
  self-guesses 30 s worst-case and self-aborts — hence `--no-budget` for known-
  long calls on Pi. `dispatch.detectHarnessBudgetMs()`/`detectHarnessName()` now
  take `flags` and return `Infinity`/`'no-limit …'` when opted out; the worst-
  case 30 s default for *unknown* harnesses is unchanged (Copilot safety).
- `dispatch` never passes `Infinity` as an HTTP timeout (Node clamps it to ~1 ms
  and would abort immediately); unlimited → `undefined` → provider default.
- Skills registered in `harness-install.mjs` (now 4 skills symlinked per
  harness); version bumped to 4.2.0 across bins, `package.json`, postinstall,
  and all `SKILL.md` metadata.

### Why

`search "a" "b" "c"` runs **sequentially** by design (rate-limit safety). Broad
research and ambiguity-first planning want genuine concurrency; `search-parallel`
provides it without sacrificing key rotation, fallback, or partial-failure
tolerance. And on a harness with no bash timeout (Pi core), the self-budget
abort was the only thing capping long fan-outs — `--no-budget` removes it
deliberately, only where the user knows it is safe.

## v4.1.0 — surf-plan-skill: enforce research before ANY plan (plan-mode fix)

### The bug

`surf-plan-skill` delivered plans **without running any web research**,
especially when the plan was presented for user approval (Claude Code
plan mode / `ExitPlanMode`). The skill's whole value — research-grounded
plans — silently didn't happen.

### Root causes (three, stacking)

1. **Plan mode blocks Bash.** The skill's only research mechanism was
   the `surf-search-skill` CLI via the Bash tool. Harness plan modes —
   the exact modes that present a plan for approval — block Bash (and
   Write) entirely, allowing only read-only tools (Read, Glob, Grep,
   WebSearch, WebFetch, AskUserQuestion). The agent triggered the
   skill, found Bash blocked, skipped research, and presented an
   unresearched plan for approval. The SKILL.md said nothing about
   approval modes or fallbacks, and its Phase 0 "halt if the CLI is
   unreachable" rule turned every Bash restriction into a dead end.
2. **Invalid `allowed-tools` frontmatter.** Both skills listed
   lowercase tool names (`bash, read, glob, grep, edit, write`). Claude
   Code tool names are PascalCase (`Bash`, `Read`, …) and matching is
   case-sensitive, so nothing was actually pre-approved — every
   research call hit a permission prompt, adding friction that nudged
   agents toward skipping searches.
3. **No verifiable gate.** The 6-phase workflow was descriptive prose;
   nothing forced the agent to produce evidence that research happened
   before the plan went out. Anthropic's skill-authoring guidance:
   models skip steps unless you add checklists + verifiable
   intermediate outputs.

### Fix

`skills/surf-plan-skill/SKILL.md` rewritten (v4.1.0):

- **THE GATE**: the agent may not present, write, file, or submit a
  plan — through any channel, including `ExitPlanMode`/plan-approval
  tools — until the Research Ledger shows the Phase 2 baseline batch
  (≥3 queries) and the Phase 5 synthesis batch (≥2 queries), plus one
  search per clarifying question. The only bypass is the user
  explicitly accepting a plan labeled "NOT WEB-RESEARCHED".
- **Layered research (A→B→C)**: Layer A = `surf-search-skill` via Bash
  (preferred); Layer B = harness-native WebSearch/WebFetch (Bash
  blocked/denied/missing — e.g. plan mode); Layer C = nothing available
  → halt and let the user decide. **A blocked layer means fall back,
  never skip.** Mid-flow Layer A failures downgrade to B.
- **Plan-approval mode integration**: Phases 0–5 run BEFORE the
  approval tool is called; the submitted plan embeds Decisions-with-
  citations + Research Ledger; the plan file is written immediately
  after approval (Write is blocked before).
- **Progress checklist** the agent copies into its response and updates
  (skipped phases become visible), per Anthropic best practices.
- **Research Ledger** — new required plan section: one row per query
  (phase, layer, query, footnotes used). Every Decision footnote must
  trace to a ledger row; fabricated ledgers are called out as the worst
  anti-pattern.
- **Frontmatter**: `allowed-tools` fixed to valid PascalCase scoped
  rules (`Bash(surf-search-skill:*), Bash(surf-plan-skill:*), Read,
  Glob, Grep, Write, Edit, WebSearch, WebFetch, AskUserQuestion`);
  description rewritten to be directive ("MUST BE USED … BEFORE any
  plan is presented for approval"), mention plan mode, and include
  Portuguese trigger phrases ("faça um plano", "planeje isso", …);
  added `argument-hint`.
- Phase 0 no longer hard-halts when the CLI is missing — it resolves
  the best available layer; only Layer C halts (user's call).

Root `SKILL.md` (search skill): `allowed-tools: bash` →
`Bash(surf-search-skill:*), Bash(surf:*)` (same casing bug, scoped).

### Files changed

- `skills/surf-plan-skill/SKILL.md` — rewritten (gate, layers,
  plan-mode integration, checklist, ledger, frontmatter).
- `SKILL.md` — `allowed-tools` casing/scoping fix + version.
- `references/plan-workflow.md` — documents the gate, layers, and
  plan-approval-mode behavior; updated phases and anti-patterns.
- `bin/surf-plan-skill.mjs` — help text reflects the new Phase 0/6 and
  THE GATE; `VERSION` → `4.1.0`.
- `bin/{surf,surf-search-skill}.mjs`, `src/install/postinstall.mjs`,
  `package.json`, `README.md` — version bump + gate note in README.

### Upgrading

```bash
npm i -g surf-skill@latest
surf-plan-skill --version    # 4.1.0
```

Then ask your agent for a plan (plan mode included) — it must show the
progress checklist, run the searches (or visibly fall back to
WebSearch), and the delivered plan must contain a Research Ledger.

## v4.0.1 — fix missing `surf-search-skill` bin after v4.0.0 rename

### The bug

`npm i -g surf-skill@4.0.0` installed the package but did **not** create
the `surf-search-skill` command on PATH. Only `surf` and
`surf-plan-skill` symlinks were created. Calling `surf-search-skill …`
produced `command not found`, breaking the skill end-to-end.

### Root cause

The v4.0.0 rename moved `bin/surf-skill.mjs` → `bin/surf-search-skill.mjs`
(file rename) but `package.json#bin` was missed — it still mapped
`"surf-skill": "./bin/surf-skill.mjs"`, pointing at a file that no longer
exists. npm silently skipped the broken bin entry instead of erroring,
so no `surf-search-skill` symlink was ever created.

### Fix

- `package.json#bin`: `"surf-skill": "./bin/surf-skill.mjs"` →
  `"surf-search-skill": "./bin/surf-search-skill.mjs"`.

### Files changed

- `package.json` (bin entry + version bump).
- `bin/{surf,surf-search-skill,surf-plan-skill}.mjs` — `VERSION` →
  `4.0.1`.
- `src/install/postinstall.mjs` — banner string.
- `SKILL.md`, `skills/surf-plan-skill/SKILL.md` — frontmatter
  `version: "4.0.1"`.
- `README.md` — Status badge and Repository layout heading.

### Upgrading

```bash
npm i -g surf-skill@latest
surf-search-skill --version   # 4.0.1
```

No other behavior changes — this is purely a packaging fix.

## v4.0.0 — rename `surf-skill` skill → `surf-search-skill` (consistent suffix), audit cleanup

### Why a major bump

In v3.0.0/v3.0.1 (GitHub-only experiments), we shipped a 2-skill bundle
named `surf-skill` (search) + `surf-plan-skill` (planning). That naming
was asymmetric — the search skill was missing the `-skill` suffix while
the planning skill had it. v4.0.0 makes both consistent:

- **Skill name `surf-skill` → `surf-search-skill`** (frontmatter, harness
  symlinks, all docs).
- **Bin `surf-skill` → `surf-search-skill`** (renamed; old bin removed —
  scripts that called `surf-skill ...` need to update).

The **npm package name stays `surf-skill`** (it's the bundle name; the
two skills + 3 bins live inside it). So `npm i -g surf-skill` continues
to install the package, just exposing different binaries inside.

### Breaking changes for v2.x users

- Scripts that ran `surf-skill <subcommand>` must now run
  `surf-search-skill <subcommand>`. Example:
  ```bash
  # before (v2.x)
  surf-skill search "claude api"

  # after (v4.0.0)
  surf-search-skill search "claude api"
  # OR use the wrapper (NEW in v3+):
  surf search                            # interactive setup
  ```
- The harness symlink `~/.claude/skills/surf-skill` is now
  `~/.claude/skills/surf-search-skill`. Postinstall removes the old
  symlink (it's in `LEGACY_NAMES` cleanup) and creates the new one.
- Agent prompts that referenced "surf-skill" by name should now say
  "surf-search-skill" — this is mainly docs/instructions, since the
  agent discovers skills by what's in `~/.claude/skills/`.

### What's new vs v3.0.1

- All `surf-skill` references in skill names, CLI commands, banners,
  HELP text, error messages, postinstall output, and docs updated to
  `surf-search-skill`. npm package name + URLs + library imports remain
  `surf-skill` (correct — that's the npm distribution unit).
- `harness-install.mjs::SKILLS` array now lists `surf-search-skill` as
  the search skill (was `surf-skill`).
- `harness-install.mjs::LEGACY_NAMES` adds `surf-skill` and `surf-plan`
  so upgrades from v2/v3 cleanly remove old symlinks before creating new
  ones.
- `references/plan-workflow.md`, `src/plan/plan-file.mjs`,
  `src/lib/project-config.mjs`, `src/lib/format.mjs`, `src/lib/keys-cmd.mjs`
  all updated.

### Audit fixes (bugs caught while renaming)

- v3.0.0/v3.0.1 had several stale `surf-plan` (bare, no `-skill` suffix)
  refs in `src/plan/plan-file.mjs:154` (docstring) and
  `references/plan-workflow.md` (section headers) — leftover from the
  standalone v1.0.0 migration. Fixed.
- The v3.0.0 `src/install/postinstall.mjs` banner hardcoded `3.0.0` —
  now reads correctly (and updated to 4.0.0).
- The v3.0.0 `bin/surf-plan-skill.mjs` HELP title was `surf-plan-skill-skill`
  from an over-aggressive sed during the v2→v3 migration. Fixed.
- `package.json` `test:syntax` script referenced the old `bin/surf-skill.mjs`
  filename — updated to `bin/surf-search-skill.mjs` so CI/local tests pass.

### Files changed (high-level)

- Renamed: `bin/surf-skill.mjs` → `bin/surf-search-skill.mjs` (git rename).
- Edited: `SKILL.md`, `skills/surf-plan-skill/SKILL.md`, all bins,
  `package.json`, `README.md`, `CHANGELOG.md`,
  `src/lib/{harness-install,check-surf-skill,keys-cmd,project-config,format}.mjs`,
  `src/install/postinstall.mjs`, `src/index.mjs`, `src/plan/plan-file.mjs`,
  `references/plan-workflow.md`.
- Internal `VERSION` constants in all bins, `dispatch.mjs`, and
  `validators/index.mjs` bumped to `4.0.0`.

### What didn't change

- npm package name: still `surf-skill`.
- npm package install: still `npm i -g surf-skill`.
- Library imports: still `import { search } from 'surf-skill'`.
- Provider adapter behavior, dispatch fallback, validator logic,
  keys.json schema, plan-file format, harness directories — all
  unchanged from v3.0.1.
- The `surf-plan-skill` skill name stays as is (was already correct).

### Migration

```bash
# Upgrade:
npm i -g surf-skill@latest

# Verify all 3 bins:
surf --version              # 4.0.0
surf-search-skill --version # 4.0.0
surf-plan-skill --version   # 4.0.0

# Check the new symlinks (and old ones removed):
ls ~/.claude/skills/        # surf-search-skill + surf-plan-skill (NO surf-skill)
ls ~/.agents/skills/        # same
```

Find/replace in your scripts: `surf-skill ` → `surf-search-skill ` (mind
the trailing space so you don't break `npm i -g surf-skill`).

---

## v3.0.1 — package.json fix for the v3.0.0 bundle

v3.0.0 shipped to GitHub with a partial `package.json` edit: the new
`surf` and `surf-plan-skill` `bin` entries were missing, the `version`
field wasn't bumped (still `2.1.1`), and the description didn't mention
the planning skill. The skill code itself was fine, but `npm i -g
surf-skill@3.0.0` would only install the `surf-skill` binary, hiding the
new `surf` wrapper and `surf-plan-skill` CLI. v3.0.1 corrects the
manifest so the bundle actually exposes all 3 bins on install.

What changed in v3.0.1 vs v3.0.0:

- `package.json::version` 2.1.1 → 3.0.1
- `package.json::bin` includes all 3: `surf`, `surf-skill`, `surf-plan-skill`
- `package.json::description` updated to describe the bundle (2 skills)
- `package.json::exports` adds `./plan` and `./validators` subpath exports
- `SKILL.md::metadata.version` 2.1.1 → 3.0.1
- All internal `VERSION` constants bumped to 3.0.1

No code-behavior changes vs v3.0.0; release v3.0.0 is superseded.

If you installed v3.0.0 by hand from GitHub: upgrade with
`npm i -g surf-skill@latest` and `surf doctor` to confirm all 3 bins
are present.

---

## v3.0.0 — multi-skill bundle: surf-skill + surf-plan-skill + `surf` wrapper with live key validation

### What's new

This release reshapes the package from one skill into **two skills + a
top-level setup wrapper**, all installed by `npm i -g surf-skill`.

**New skill: `surf-plan-skill`** — research-driven execution planning
that follows a strict 6-phase workflow (preflight → project discovery →
baseline web research → conversation → clarifying questions each backed
by search → synthesis search → write Markdown plan with `[^N]` cited
footnotes). Triggers on "make a plan", "design X", "architect Y", etc.
Plans land in `~/.claude/plans/` (or `./plans/` if it exists).

**New CLI: `surf`** — the friendliest entry point. Interactive setup
wizard that:
- Detects both skills in all 4 harness skill dirs.
- Lists configured keys per provider (masked).
- **Validates every key against its provider's real API before saving**
  (1-credit cost, 1-3s per key). Invalid keys are dropped with a clear
  error; valid keys are saved.
- Re-validates existing keys on demand.

**Validation is now mandatory at every key-add path**:
- `surf` interactive add: live-validates before saving.
- `surf-skill setup`: validates each freshly-collected key in the wizard
  batch; drops invalid; reports a summary.
- `surf-skill keys add --provider X <key>`: validates before saving.
  Opt out with `--skip-validate` (for known-good or offline scenarios).

### Bins shipped (3)

- `surf` — interactive setup + key validation (new)
- `surf-skill` — search engine (unchanged surface; 3.0.0 internal)
- `surf-plan-skill` — planning skill CLI (list/show/new/doctor)

### Package layout

```
surf-skill/
├── bin/{surf,surf-skill,surf-plan-skill}.mjs
├── SKILL.md                        # surf-skill skill (root)
├── skills/surf-plan-skill/SKILL.md # surf-plan-skill (planning)
├── src/
│   ├── index.mjs                   # library entry (search + extract + ...)
│   ├── plan/                       # plan-file, plans-dir, slug
│   ├── validators/                 # per-provider key validators
│   ├── lib/                        # adapters, dispatch, state, cost, ...
│   └── install/                    # postinstall + preuninstall
└── references/
```

### Postinstall (cross-OS)

Each of the 4 supported harness skill dirs now gets **2 symlinks**:

- `<harness>/surf-skill`      → package root (search skill)
- `<harness>/surf-plan-skill` → `skills/surf-plan-skill/` (planning skill)

Harnesses: `~/.agents/skills`, `~/.claude/skills`, `~/.codex/skills`,
`~/.pi/agent/skills`. Symlink on POSIX + Windows-with-Developer-Mode;
falls back to recursive copy on Windows without it.

Existing v2.x users: the surf-skill symlink still points at package root
(unchanged); the new surf-plan-skill symlink is added.

### Migration from v2.x

```bash
npm i -g surf-skill           # picks up v3.0.0
surf doctor                   # confirm both skills + keys
surf                          # interactive — add more keys if needed
```

Your existing `~/.config/surf/keys.json` is preserved. CLI commands
that worked in v2.x still work in v3.0.0 (no breaking flag changes;
only additive behavior: validation defaults on for `keys add`, opt out
with `--skip-validate` if needed).

### Migration from the standalone `surf-plan` v1.0.0 (now retired)

The standalone `frederico-kluser/surf-plan` repo and the unpublished
`surf-plan` npm name are retired. Use `npm i -g surf-skill` — it bundles
the planning skill as `surf-plan-skill`. The SKILL.md frontmatter name
changed from `surf-plan` → `surf-plan-skill`.

---

## v2.1.1 — Robust key rotation: Brave 422 now burns the key

### Bug

When a Brave key was malformed (wrong length/charset), the API returns
HTTP **422** rather than 401. v2.1.0 classified 422 as `caller_4xx`, which
made dispatch throw without burning the key or trying the next one. That
violated the cross-provider fallback contract: a single bad-format key
could short-circuit the chain instead of rotating.

### Fix

`src/lib/providers/brave.mjs::mapError` now classifies 422 as `auth`
(burn key, rotate). The trade-off:

- **Real malformed token** → burns the key, dispatch tries the next key
  (or next provider if `--provider` not set). The user gets a result.
- **Genuinely bad query param** → all keys fail with 422; surfaces as
  `AllProvidersExhausted` with a hint, still actionable.

### Verified

Re-ran the 3 fallback tests with v2.1.1:

- T1 same-provider rotation (tavily key #0 bad → key #1 succeeds): ✓
- T2 cross-provider fallback (tavily/parallel both 401 → brave 200): ✓
- T3 all keys bad incl. malformed Brave: **now burns Brave key + reports
  AllProvidersExhausted** (instead of throwing on the 422)

### Also fixed

- `src/lib/dispatch.mjs::VERSION` was stuck at `1.0.0` since the initial
  release; bumped to `2.1.1` so the `X-Client-Name` header surfaces
  the correct CLI version to providers.
- `SKILL.md::metadata.version` was missed in the v2.1.0 bump (still
  showed `2.0.0`); now `2.1.1`.

No breaking changes.

---

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
