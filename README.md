<p align="center">
  <img src="logo.png" alt="surf-skill logo" width="160" />
</p>

<h1 align="center">surf-skill</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/surf-skill"><img src="https://img.shields.io/npm/v/surf-skill?style=flat-square&color=black" alt="npm" /></a>
  <a href="https://www.npmjs.com/package/surf-skill"><img src="https://img.shields.io/npm/dt/surf-skill?style=flat-square&color=black" alt="downloads" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/surf-skill?style=flat-square&color=black" alt="MIT" /></a>
  <img src="https://img.shields.io/node/v/surf-skill?style=flat-square&color=black" alt="node>=18" />
</p>

<p align="center">
  Multi-provider web skill for AI coding agents.<br/>
  Fronts <strong>Tavily</strong>, <strong>Parallel AI</strong> and <strong>Brave</strong> behind a single CLI + Node library — with automatic key rotation, provider fallback, and last-known-good persistence. Ships a separate free, keyless search skill (<strong>surf-free-skill</strong>: Wikipedia + DuckDuckGo, no API key).
</p>

---

**Three skills. Three providers. One install.** `npm i -g surf-skill` bundles
**`surf-research-skill`** (multi-provider web research — a single lookup,
parallel fan-out, or async deep research, auto-routed by query complexity
and harness), **`surf-plan-skill`** (research-driven execution planning
that auto-routes into a full ambiguity-sweep mode for vague/high-stakes
work), and **`surf-free-skill`** (free, keyless web search via Wikipedia +
DuckDuckGo — no API key), plus a friendly `surf` setup wrapper with live key
validation. Each skill decides its own depth.

```
                  ┌──▶ Tavily   (search, extract, crawl, map, research)
search    ─┐      │
extract   ─┤      │
crawl    ──┼──▶ surf-research-skill ──▶ Parallel (search, extract, research async)
map      ──┤      │        │
research ──┘      │        └─▶ mode router: Normal (1 call) / Parallel (fan-out)
                  │            / Deep (fan-out + async research, iterates on Pi)
                  └──▶ Brave    (search only — own index)

free search  ──▶ surf-free-skill ──▶ Wikipedia + DuckDuckGo (keyless, no API key)

plan / design ──▶ surf-plan-skill ──▶ mode router: Normal (research-grounded)
                                       / Deep (+ ambiguity sweep, auto on
                                       vague/high-stakes work or by request)
                                    └▶ calls surf-research-skill for its own research (cited)
```

| | |
|---|---|
| **Status** | v5.2.0 (npm) |
| **Install** | `npm i -g surf-skill` (Linux · macOS · Windows) |
| **Skills shipped** | `surf-research-skill` · `surf-plan-skill` (each auto-routes between a fast and a deep mode) |
| **Bins shipped** | `surf` (interactive setup + validation), `surf-research-skill`, `surf-plan-skill` |
| **Runtime** | Node ≥ 18. Zero npm deps. |
| **Storage** | `~/.config/surf/keys.json` (chmod 600). Never read from env at runtime by the CLI. |
| **Supported agents** | Claude Code · GitHub Copilot CLI · Pi Coding Agent · OpenCode · Codex CLI |
| **Spec** | [Anthropic Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) |

## Quickstart (60 seconds)

```bash
npm i -g surf-skill          # installs all 3 skills + 4 bins (cross-OS)
surf                         # interactive: add keys with LIVE validation
                             #   ✓ valid (tavily, HTTP 200, 1.2s, 1 credit)
                             #   ✗ invalid (auth, HTTP 401) — NOT saved

# Use directly:
surf-research-skill search "claude 4.7 release notes" --max 3
surf-research-skill search "X" --provider brave --mode fast

# Or ask an AI agent:
> make a plan for adding rate limiting to my Express API
# → surf-plan-skill kicks in: reads project, runs surf-research-skill searches,
#   asks 3-5 researched questions, writes ~/.claude/plans/<slug>-<ts>.md
#
# Research is gated, not optional: the agent may not present a plan —
# including for plan-mode approval — before the searches are done. When
# the harness blocks Bash (e.g. Claude Code plan mode), the skill falls
# back to the harness's native WebSearch/WebFetch instead of skipping.
```

---

## Quickstart (30 seconds)

```bash
# One-liner cross-OS install (Linux, macOS, Windows)
npm i -g surf-skill

# That's it — postinstall creates symlinks into all supported harnesses,
# initializes ~/.config/surf/keys.json, and prints a hint.
# On first run, an interactive wizard auto-launches in TTY:

surf-research-skill search "your query"
# → "No keys configured. Launching setup wizard…"
# → prompts for Tavily key #1, #2, …, Parallel key #1, #2, …
# → resumes your command

# In each project where you'll use surf-research-skill (REQUIRED for GH Copilot CLI):
cd path/to/your-project
surf-research-skill project-config
```

You can also run `surf-research-skill setup` manually anytime to add more keys.

### Use as a Node library

```bash
npm i surf-skill
```

```js
import { search, extract, research } from 'surf-skill';

// Auto-discovers keys: opts > process.env > .env > ~/.config/surf/keys.json
const r = await search('claude api', { max: 3 });
console.log(r.data.results[0].url);

// Or pass keys explicitly (great for serverless / Next.js API routes)
const r2 = await search('x', {
  tavilyKeys: [process.env.MY_TAVILY_1, process.env.MY_TAVILY_2],
  depth: 'advanced',
});

// Batch search (single call, N queries, partial-failure tolerant, sequential)
const batch = await search(['topic A', 'topic B', 'topic C'], { max: 2 });

// Parallel search (concurrent fan-out, bounded worker pool)
import { searchParallel } from 'surf-skill';
const par = await searchParallel(['angle A', 'angle B', 'angle C'], { concurrency: 6, max: 3 });

// Deep research
const job = await research('compare X vs Y', { model: 'mini' });
console.log(job.data.content);
```

Library works server-side (Node / Next.js API routes / Express). Not for
browser bundles — Tavily and Parallel don't enable CORS for browser origins.

---

## Why this exists

You have a Tavily key. Maybe a Parallel one too. Maybe several Tavily keys
to spread cost across accounts. Today every agent skill is **1-to-1** with
a provider — when a key dies or a provider has an outage, your agent loop
breaks.

`surf-research-skill` is a connector:

- **Multi-key per provider.** Add as many keys as you want; rotation is
  automatic on `401`/`403`/`402` (auth, insufficient credits) or persistent
  `5xx`. Burned keys auto-reset on the first day of the next calendar
  month (assuming monthly billing).
- **Provider fallback.** If all Tavily keys are burned, `search`/`extract`
  fail over to Parallel — transparently. `crawl` and `map` stay on Tavily
  (Parallel doesn't have them). `research` defaults to Parallel first
  because its Task API is the strongest deep-research surface.
- **Hot-path memory.** The last successful provider/key is remembered in
  `~/.config/surf/keys.json`. The next call starts there — no cold-start
  cost.
- **Predictable output.** `--json` returns the same normalized envelope
  no matter which provider answered.

---

## Supported agents

> The installer configures every harness it can. The user only has to
> manually configure GitHub Copilot CLI (per project) because it has no
> global timeout setting.

### Claude Code

```bash
npm i -g surf-skill
# Installer writes ~/.claude/settings.json:
#   { "env": { "BASH_DEFAULT_TIMEOUT_MS": "300000",
#              "BASH_MAX_TIMEOUT_MS": "600000" } }
```

The skill becomes available at `~/.claude/skills/surf-research-skill/`. In a Claude
Code session, just ask: "search the web for X" — the agent will invoke
`surf-research-skill` via Bash. For commands that may exceed 5 min, the agent can
pass `timeout: 600000` on the Bash call (10 min hard cap), or set
`run_in_background: true` and monitor via `/tasks`.

### GitHub Copilot CLI

⚠️ **Default bash timeout is 30 s — the most fragile of the three.**

```bash
npm i -g surf-skill
# Symlink created at ~/.copilot/skills/ (via ~/.agents/skills/surf-research-skill).
```

**Per-project**, run inside the project root:

```bash
surf-research-skill project-config
# writes .github/copilot-hooks.json with { "timeoutSec": 300 }
# detects .github/ automatically; use --harness copilot --yes to force
```

Without this, any `surf-research-skill` command other than `--help`, `--version`,
`keys list/add`, or `search --max 1` will time out. With it, you can use
the full command set up to ~5 min per call.

For longer operations, use Copilot CLI's async pattern: `/delegate` the
`surf-research-skill research-start ...` call, then poll with `surf-research-skill
research-poll <id>` from a regular session.

If surf-research-skill detects the agent will likely kill the call before it can
finish, it now aborts early with `LikelyAgentTimeout` and tells the agent
to suggest `surf-research-skill project-config` to the user — instead of dying
silently to SIGTERM.

### Pi Coding Agent

```bash
npm i -g surf-skill
# Symlinks the skills into ~/.pi/agent/skills/.
```

**Pi core applies NO bash timeout** — long `surf-research-skill` calls (parallel
fan-out, crawls, research) run unbounded by default. surf can't detect Pi from
the environment, so it falls back to a 30 s worst-case guess and self-aborts;
for calls you know are long, pass **`--no-budget`** (or `SURF_NO_TIMEOUT=1`):

```bash
surf-research-skill search-parallel --queries-file q.json --concurrency 8 --no-budget
```

If you run the optional **`pi-bash-timeout`** extension it re-imposes a 120 s
cap; `surf-research-skill project-config` raises that to 300 s (writes
`.pi/settings.json`). For long-running work, Pi also supports subagents.

### OpenCode & Codex CLI

Also auto-configured by the installer (`~/.agents/skills/surf-research-skill/` and
`~/.codex/skills/surf-research-skill/`). OpenCode gets `mcp_timeout` + `bash.timeout_ms`
set to 600 000 ms in `~/.config/opencode/opencode.json`.

---

## Timeouts at a glance

| Agent | Default bash | Max | After install | Most likely to time out? |
|---|---|---|---|---|
| **Claude Code** | 120 s | 600 s (hard) | 300 s default | Long crawls > 5 min |
| **GitHub Copilot CLI** | **30 s** | not documented | unchanged (no global config) | **YES — most commands** |
| **Pi Coding Agent** | **none (core)** | unbounded | use `--no-budget` for long calls | No (core); 120 s only with `pi-bash-timeout` ext |
| **OpenCode** | varies | 600 s | 600 s default | Rarely |

If you see timeouts, the order of fixes:

0. On a **no-limit harness (Pi core)**, pass `--no-budget` (or
   `SURF_NO_TIMEOUT=1`) so surf doesn't self-abort at its 30 s worst-case guess.
1. Use `surf-research-skill research-start` + `research-poll` instead of sync
   `research`.
2. Reduce `--limit` / `--max` / `--max-depth`.
3. Bump the per-harness timeout (see the relevant card above).
4. Set `SURF_TIMEOUT_MS=300000` (caps the HTTP request itself at 5 min).

---

## Commands

| Command | What it does | Provider(s) |
|---|---|---|
| `setup` | Interactive wizard to add keys (TTY) | n/a |
| `project-config` | Write per-project bash-timeout config | n/a |
| `search <q> [q2 ...]` | Web search; multiple positional args = **batch** (sequential) | tavily, parallel, **brave** |
| `search-parallel <q…>` | **Parallel** fan-out (bounded pool); `--queries-file`, `--concurrency` | tavily, parallel, brave |
| `extract <url> ...` | Pull markdown from URLs (`--urls-file` accepted) | tavily, parallel |
| `crawl <url>` | Recursive site crawl | tavily |
| `map <url>` | Sitemap discovery | tavily |
| `research <topic>` | Sync deep research (50 s budget) | parallel, tavily |
| `research-start <topic>` | Start async research | parallel, tavily |
| `research-poll <id>` | Poll an async research job | (sticky to provider) |
| `usage --provider <name>` | Provider's usage endpoint | per provider |
| `cache-clear` | Purge response cache | n/a |
| `cost [--reset]` | Local credit ledger (per-provider) | n/a |
| `keys <subcmd>` | `add`, `remove`, `list`, `reset`, `clear` | n/a |

Full reference: `skills/surf-research-skill/SKILL.md`.

Global flags every command accepts:

```
--provider <tavily|parallel|brave>  Force provider (disables fallback)
--mode <fast|normal|slow>           Search tier. Per-provider mapping:
                                      fast   = Tavily depth=fast / Brave count=5
                                      normal = default
                                      slow   = Tavily depth=advanced / Brave count=20
                                      (Parallel ignores — single mode.)
--no-fallback                       Keep default provider, no cross-provider fallback
--no-cache                          Skip response cache
--no-budget                         Disable the self-budget abort — let calls run
                                      to the provider's per-request ceiling. No-limit
                                      harnesses only (Pi core). = SURF_NO_TIMEOUT=1
--json                              Normalized envelope as JSON
--raw-json                          Raw provider response (bypasses cache)
--confirm-expensive                 Allow operations estimated > 10 credits
--quiet                             Silence progress logs (stderr)
```

### Search modes

```bash
surf-research-skill search "X" --mode fast    # 5 results / 1 credit Tavily / minimal latency
surf-research-skill search "X" --mode normal  # 10 results / default everywhere
surf-research-skill search "X" --mode slow    # 20 results / Tavily advanced / deeper signal
```

Want to force a specific provider for a given mode?

```bash
surf-research-skill search "X" --provider brave --mode slow    # 20 brave results, no fallback
surf-research-skill search "X" --provider tavily --mode fast   # Tavily fast tier
```

---

## Batch your queries

When you need to research **multiple angles** of the same topic, batch them
in a single call. Each positional arg is an independent query:

```bash
surf-research-skill search "compare X vs Y" "alternatives to X" "X security issues"
```

- Runs sequentially (avoids rate-limit thrashing on a single key).
- Partial failures are reported inline — the command exits `0` if at least
  one query succeeded.
- Total credits and timing surface in the markdown header and `--json` envelope.
- Progress logs (see below) show `[i/N]` per query.

This is the recommended way for an agent to gather multi-source context in
one shot, instead of looping with N separate bash calls.

**Need true parallelism?** `surf-research-skill search-parallel` runs the queries
**concurrently** through a bounded worker pool (default 6, cap 16), tolerant of
partial failures (one 429 rotates keys/backs off; the batch never aborts). It
accepts positional queries and/or a JSON `--queries-file`
(`[ "q", {"q":"…","id":"…","sub":"…"} ]`) and groups output by sub-question:

```bash
surf-research-skill search-parallel "angle A" "angle B" "angle C" --concurrency 6 --json
surf-research-skill search-parallel --queries-file q.json --concurrency 8 --no-budget --json
```

On a no-limit harness (Pi core) add `--no-budget`; on time-limited harnesses
keep `--concurrency` modest or split the file. **`surf-research-skill`**'s
own mode router reaches for this automatically on comparisons/broad research
— fan-out gate, extraction, and cited synthesis included — so the calling
agent rarely needs to invoke `search-parallel` by hand.

---

## Progress logs (stderr)

Every operation emits one self-contained line per event to **stderr**, so
both humans and the calling LLM can see what's happening without parsing
the main result on stdout.

```
[surf 17:58:12] ▸ search → tavily (key #0)
[surf 17:58:14] ✓ search tavily 1234ms (2 credits)
[surf 17:58:14] ↻ tavily 429 — backoff 1500ms (attempt 1/3)
[surf 17:58:18] ⚠ tavily key #0 burned (401)
[surf 17:58:18] ▸ search → parallel (key #0)
[surf 17:58:20] ✓ search parallel 2102ms (2 credits)
[surf 17:58:20] ⏱ batch done: 3/3 ok, 0 failed (8200ms, 6 credits)
```

The format is stable for grep/parse. Use `--quiet` or `SURF_QUIET=1` to
silence (CI, piping, tests). Stdout stays clean either way.

---

## Multi-key & fallback

```
state.json (per provider):
  keys:       [key0, key1, key2]
  current:    1                       ← starts here next call
  burned:     [{ index: 0, reason: "401", at: "2026-05-15..." }]
                                      ← auto-reset on the 1st of next month

call flow:
  ┌─ load state, auto-reset burned ──┐
  │                                  │
  └─▶ chain = [last_ok_provider,    ─┤
              ...rest_of_capability_chain]
                                     │
  for provider in chain:             │
    for key in usable_keys(provider):│
      try call                       │
        200 ─▶ save last_ok, return  │
        401/403/402 ─▶ burn key, next│
        5xx x3 ─▶ burn key, next     │
        429 ─▶ backoff, retry        │
        4xx ─▶ raise (no fallback)   │
    (no usable keys) ─▶ next provider│
  raise AllProvidersExhausted ───────┘
```

Force a specific provider for debugging:

```bash
surf-research-skill search "x" --provider parallel
# 'parallel' fails ⇒ command fails (no fallback when --provider is set)
```

---

## Onboarding

`surf-research-skill` needs an API key. (For free, no-key search, use the
separate **`surf-free-skill`** — no setup at all.)

```bash
# 1. Wizard (recommended in a TTY)
surf-research-skill setup

# 2. Direct — many keys per provider in one call (each live-validated)
surf-research-skill keys add --provider tavily tvly-AAA tvly-BBB tvly-CCC
cat parallel-keys.txt | surf-research-skill keys add --provider parallel --stdin

# 3. Auto-launch in a TTY: run any command without keys
surf-research-skill search "test"
# → in a TTY with no keys: launches the setup wizard

# Free, no-key search (separate skill, zero setup):
surf-free-skill "your query"

# 4. Library mode: env vars / .env / explicit opts (no setup needed)
TAVILY_API_KEY=tvly-... node -e "import('surf-skill').then(m => m.search('x'))"
```

Inspect what was stored (keys are masked):

```bash
surf-research-skill keys list
# **Surf keys** (config: ~/.config/surf/keys.json)
# last_ok_provider: `tavily`
# ## tavily (2 keys)
# - [0] tvly-…ab12  *(current)*
# - [1] tvly-…cd34
```

---

## Troubleshooting

**`❌ Error [NoProviderAvailable]: operation 'X' requires one of [...]`**
→ The op needs a key for a provider you haven't configured. In a TTY the
error already suggests `surf-research-skill setup`. Outside TTY, run
`surf-research-skill keys add --provider <name> <key>`.

**`❌ Error [AllProvidersExhausted]: ...`**
→ Every key on every eligible provider failed. Check `surf-research-skill keys list`
— if everything is `burned`, you've either rotated keys mid-billing-cycle
or the providers are down. Run `surf-research-skill keys reset` to retry.

**Command timed out in GH Copilot CLI**
→ Run `surf-research-skill project-config` inside the project root. See the
Copilot CLI card above.

**`❌ Error [LikelyAgentTimeout]: ...`**
→ surf-research-skill detected the harness will kill the call before it finishes
(typical on Copilot CLI without per-project config). Run `surf-research-skill
project-config` in the project, then retry. Don't retry the same call
without fixing the timeout first.

**`❌ Error [KilledBySignal]: surf-research-skill received SIGTERM/SIGINT`**
→ The harness killed us mid-flight. Same fix as `LikelyAgentTimeout`. The
SIGTERM handler exists as a fallback — the self-budget check should fire
first when env vars are set.

**`❌ Error: EXPENSIVE_BLOCKED ...`**
→ Pass `--confirm-expensive` after confirming the cost with the user. Or
export `SURF_ALLOW_EXPENSIVE=1` for the session.

**`Refusing sync research with model=pro`**
→ Use `surf-research-skill research-start --model pro ...` then `surf-research-skill
research-poll <id>`. Sync research is capped at 50 s on purpose.

---

## Repository layout (v5.2.0)

```text
.
├── package.json                       ← name: surf-skill (npm), version 5.2.0, 4 bins
├── README.md           ← you're here
├── CHANGELOG.md
├── LICENSE
├── logo.png
├── SKILL.md                           ← surf-research-skill (search/parallel/deep research, root of pkg)
├── bin/
│   ├── surf.mjs                       ← interactive setup + key validation
│   ├── surf-research-skill.mjs        ← multi-provider web research CLI
│   └── surf-plan-skill.mjs            ← planning workflow CLI
├── skills/
│   └── surf-plan-skill/
│       └── SKILL.md                   ← surf-plan-skill (planning, auto-routes to an ambiguity-sweep mode)
├── src/
│   ├── index.mjs                      ← library entry (search/extract/research/...)
│   ├── env.mjs                        ← key discovery (opts > env > .env > config)
│   ├── plan/                          ← plan-file, plans-dir, slug (planning lib)
│   ├── validators/                    ← per-provider key validators (live API)
│   ├── lib/
│   │   ├── state.mjs                  ← ~/.config/surf/keys.json I/O
│   │   ├── cache.mjs                  ← TTL response cache
│   │   ├── audit.mjs                  ← audit + usage JSONL
│   │   ├── flags.mjs, cost.mjs, format.mjs
│   │   ├── dispatch.mjs               ← provider/key fallback + self-budget (+ --no-budget)
│   │   ├── pool.mjs                   ← bounded-concurrency worker pool (search-parallel)
│   │   ├── keys-cmd.mjs               ← surf-research-skill keys add/remove/...
│   │   ├── setup.mjs                  ← interactive onboarding (with validation)
│   │   ├── project-config.mjs         ← surf-research-skill project-config
│   │   ├── progress.mjs               ← stderr progress events
│   │   ├── check-surf-skill.mjs       ← detect companion CLI in PATH
│   │   ├── harness-install.mjs        ← cross-OS symlink install for 3 skills
│   │   ├── api/                       ← library search/extract/crawl/map/research
│   │   └── providers/
│   │       ├── index.mjs              ← capability map (search + 3 providers)
│   │       ├── tavily.mjs
│   │       ├── parallel.mjs
│   │       └── brave.mjs
│   └── install/
│       ├── postinstall.mjs            ← cross-OS symlinks + skeleton keys.json
│       └── preuninstall.mjs           ← cleanup our symlinks
└── references/
    ├── tavily-api.md
    ├── parallel-api.md
    ├── plan-workflow.md               ← deeper docs on the planning workflow (Normal + Deep ambiguity-sweep mode)
    └── COSTS.md
```

---

## Security

- This repository contains **no real API keys**. The installer only uses
  placeholders.
- Keys are stored exclusively in `~/.config/surf/keys.json` (chmod 600).
  `surf-research-skill` does not read keys from env at runtime.
- The audit log records only `provider` name and key **index**, never the
  key itself. `surf-research-skill keys list` masks every key (`tvly-…ab12`).
- The skill never executes content returned from the web — it just prints it.
- Review any skill before installing. Skills can instruct agents to run
  commands.

---

## License

MIT.
