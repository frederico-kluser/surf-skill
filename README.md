# surf-skill

**One bash command. Two providers. Zero MCP.** A multi-provider web skill
for AI coding agents that fronts **Tavily** and **Parallel AI** behind a
single CLI (`surf-skill`). The agent calling this skill **never picks the
provider** — `surf-skill` does, with automatic key rotation, provider
fallback, and last-known-good persistence.

```
search ─┐
extract ┤            ┌──▶ Tavily   (search, extract, crawl, map, research)
crawl ──┼──▶ surf ───┤
map  ───┤            └──▶ Parallel (search, extract, research async)
research┘
```

| | |
|---|---|
| **Status** | v1.0.0 |
| **Runtime** | Node ≥ 18, bash. Zero npm deps. |
| **Storage** | `~/.config/surf/keys.json` (chmod 600). Never read from env at runtime. |
| **Supported agents** | Claude Code · GitHub Copilot CLI · Pi Coding Agent · OpenCode · Codex CLI |
| **Spec** | [Anthropic Agent Skills](https://docs.claude.com/en/docs/agents-and-tools/agent-skills) |

---

## Quickstart (30 seconds)

```bash
# One-liner cross-OS install (Linux, macOS, Windows)
npm i -g surf-skill

# That's it — postinstall creates symlinks into all supported harnesses,
# initializes ~/.config/surf/keys.json, and prints a hint.
# On first run, an interactive wizard auto-launches in TTY:

surf-skill search "your query"
# → "No keys configured. Launching setup wizard…"
# → prompts for Tavily key #1, #2, …, Parallel key #1, #2, …
# → resumes your command

# In each project where you'll use surf-skill (REQUIRED for GH Copilot CLI):
cd path/to/your-project
surf-skill project-config
```

You can also run `surf-skill setup` manually anytime to add more keys.

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

// Batch search (single call, N queries, partial-failure tolerant)
const batch = await search(['topic A', 'topic B', 'topic C'], { max: 2 });

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

`surf-skill` is a connector:

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

The skill becomes available at `~/.claude/skills/surf-skill/`. In a Claude
Code session, just ask: "search the web for X" — the agent will invoke
`surf-skill` via Bash. For commands that may exceed 5 min, the agent can
pass `timeout: 600000` on the Bash call (10 min hard cap), or set
`run_in_background: true` and monitor via `/tasks`.

### GitHub Copilot CLI

⚠️ **Default bash timeout is 30 s — the most fragile of the three.**

```bash
npm i -g surf-skill
# Symlink created at ~/.copilot/skills/ (via ~/.agents/skills/surf-skill).
```

**Per-project**, run inside the project root:

```bash
surf-skill project-config
# writes .github/copilot-hooks.json with { "timeoutSec": 300 }
# detects .github/ automatically; use --harness copilot --yes to force
```

Without this, any `surf-skill` command other than `--help`, `--version`,
`keys list/add`, or `search --max 1` will time out. With it, you can use
the full command set up to ~5 min per call.

For longer operations, use Copilot CLI's async pattern: `/delegate` the
`surf-skill research-start ...` call, then poll with `surf-skill
research-poll <id>` from a regular session.

If surf-skill detects the agent will likely kill the call before it can
finish, it now aborts early with `LikelyAgentTimeout` and tells the agent
to suggest `surf-skill project-config` to the user — instead of dying
silently to SIGTERM.

### Pi Coding Agent

```bash
npm i -g surf-skill
# Installer writes ~/.pi/agent/settings.json:
#   { "env": { "PI_BASH_DEFAULT_TIMEOUT_SECONDS": "300",
#              "PI_BASH_MAX_TIMEOUT_SECONDS": "600" } }
```

The skill becomes available at `~/.pi/agent/skills/surf-skill/`. Pi reads
the timeout from env, so the settings.json above is enough. For
long-running work, Pi supports subagents with `--bg` and the `await` tool.

### OpenCode & Codex CLI

Also auto-configured by the installer (`~/.agents/skills/surf-skill/` and
`~/.codex/skills/surf-skill/`). OpenCode gets `mcp_timeout` + `bash.timeout_ms`
set to 600 000 ms in `~/.config/opencode/opencode.json`.

---

## Timeouts at a glance

| Agent | Default bash | Max | After install | Most likely to time out? |
|---|---|---|---|---|
| **Claude Code** | 120 s | 600 s (hard) | 300 s default | Long crawls > 5 min |
| **GitHub Copilot CLI** | **30 s** | NÃO DOCUMENTADO | unchanged (no global config) | **YES — most commands** |
| **Pi Coding Agent** | 120 s | 600 s | 300 s default | Long crawls > 5 min |
| **OpenCode** | varies | 600 s | 600 s default | Rarely |

If you see timeouts, the order of fixes:

1. Use `surf-skill research-start` + `research-poll` instead of sync
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
| `search <q> [q2 ...]` | Web search; multiple positional args = **batch** | tavily, parallel |
| `extract <url> ...` | Pull markdown from URLs | tavily, parallel |
| `crawl <url>` | Recursive site crawl | tavily |
| `map <url>` | Sitemap discovery | tavily |
| `research <topic>` | Sync deep research (50 s budget) | parallel, tavily |
| `research-start <topic>` | Start async research | parallel, tavily |
| `research-poll <id>` | Poll an async research job | (sticky to provider) |
| `usage --provider <name>` | Provider's usage endpoint | per provider |
| `cache-clear` | Purge response cache | n/a |
| `cost [--reset]` | Local credit ledger (per-provider) | n/a |
| `keys <subcmd>` | `add`, `remove`, `list`, `reset`, `clear` | n/a |

Full reference: `skills/surf-skill/SKILL.md`.

Global flags every command accepts:

```
--provider <tavily|parallel>   Force provider (disables fallback)
--no-fallback                  Keep default provider, no cross-provider fallback
--no-cache                     Skip response cache
--json                         Normalized envelope as JSON
--raw-json                     Raw provider response (bypasses cache)
--confirm-expensive            Allow operations estimated > 10 credits
--quiet                        Silence progress logs (stderr)
```

---

## Batch your queries

When you need to research **multiple angles** of the same topic, batch them
in a single call. Each positional arg is an independent query:

```bash
surf-skill search "compare X vs Y" "alternatives to X" "X security issues"
```

- Runs sequentially (avoids rate-limit thrashing on a single key).
- Partial failures are reported inline — the command exits `0` if at least
  one query succeeded.
- Total credits and timing surface in the markdown header and `--json` envelope.
- Progress logs (see below) show `[i/N]` per query.

This is the recommended way for an agent to gather multi-source context in
one shot, instead of looping with N separate bash calls.

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
surf-skill search "x" --provider parallel
# 'parallel' fails ⇒ command fails (no fallback when --provider is set)
```

---

## Onboarding (3 ways)

```bash
# 1. Wizard (recommended in a TTY)
surf-skill setup

# 2. Direct
surf-skill keys add --provider tavily tvly-...
surf-skill keys add --provider parallel <key>

# 3. Auto-launch in TTY: just run any command without keys
surf-skill search "test"
# → "No keys configured. Launching setup wizard…" → prompts → resumes search

# 4. Library mode: env vars / .env / explicit opts (no setup needed)
TAVILY_API_KEY=tvly-... node -e "import('surf-skill').then(m => m.search('x'))"
```

Inspect what was stored (keys are masked):

```bash
surf-skill keys list
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
error already suggests `surf-skill setup`. Outside TTY, run
`surf-skill keys add --provider <name> <key>`.

**`❌ Error [AllProvidersExhausted]: ...`**
→ Every key on every eligible provider failed. Check `surf-skill keys list`
— if everything is `burned`, you've either rotated keys mid-billing-cycle
or the providers are down. Run `surf-skill keys reset` to retry.

**Command timed out in GH Copilot CLI**
→ Run `surf-skill project-config` inside the project root. See the
Copilot CLI card above.

**`❌ Error [LikelyAgentTimeout]: ...`**
→ surf-skill detected the harness will kill the call before it finishes
(typical on Copilot CLI without per-project config). Run `surf-skill
project-config` in the project, then retry. Don't retry the same call
without fixing the timeout first.

**`❌ Error [KilledBySignal]: surf-skill received SIGTERM/SIGINT`**
→ The harness killed us mid-flight. Same fix as `LikelyAgentTimeout`. The
SIGTERM handler exists as a fallback — the self-budget check should fire
first when env vars are set.

**`❌ Error: EXPENSIVE_BLOCKED ...`**
→ Pass `--confirm-expensive` after confirming the cost with the user. Or
export `SURF_ALLOW_EXPENSIVE=1` for the session.

**`Refusing sync research with model=pro`**
→ Use `surf-skill research-start --model pro ...` then `surf-skill
research-poll <id>`. Sync research is capped at 50 s on purpose.

---

## Repository layout

```text
.
├── package.json
├── README.md           ← you're here
├── CHANGELOG.md
├── LICENSE
└── skills/
    └── surf-skill/
        ├── SKILL.md
        ├── install.sh
        ├── bin/
        │   └── surf-skill.mjs
        ├── lib/
        │   ├── state.mjs          ← keys.json I/O, monthly auto-reset
        │   ├── cache.mjs          ← TTL response cache
        │   ├── audit.mjs          ← audit + usage JSONL
        │   ├── flags.mjs          ← parsing + helpers
        │   ├── cost.mjs           ← estimateCredits + guard
        │   ├── format.mjs         ← markdown formatters
        │   ├── dispatch.mjs       ← provider/key fallback + self-budget
        │   ├── keys-cmd.mjs       ← surf-skill keys add/remove/...
        │   ├── setup.mjs          ← interactive onboarding
        │   ├── project-config.mjs ← surf-skill project-config
        │   ├── progress.mjs       ← stderr progress events
        │   └── providers/
        │       ├── index.mjs
        │       ├── tavily.mjs
        │       └── parallel.mjs
        └── references/
            ├── tavily-api.md
            ├── parallel-api.md
            └── COSTS.md
```

---

## Security

- This repository contains **no real API keys**. The installer only uses
  placeholders.
- Keys are stored exclusively in `~/.config/surf/keys.json` (chmod 600).
  `surf-skill` does not read keys from env at runtime.
- The audit log records only `provider` name and key **index**, never the
  key itself. `surf-skill keys list` masks every key (`tvly-…ab12`).
- The skill never executes content returned from the web — it just prints it.
- Review any skill before installing. Skills can instruct agents to run
  commands.

---

## License

MIT.
