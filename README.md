# surf — multi-provider web skill for AI coding agents

Portable web search, content extraction, site crawling, URL mapping, and deep
research for AI coding agents — **without MCP**. Fronts **Tavily** and
**Parallel AI** behind one CLI (`surf`), with automatic provider fallback,
multi-key rotation per provider, and persistent "last-known-good" state.

The agent that calls this skill does **not** need to know which service is
backing the request. `surf` picks the right provider for each operation,
rotates across multiple API keys if one fails, falls back to the other
provider when needed, and remembers what worked last.

---

## Highlights

- **One skill, two providers**: Tavily + Parallel AI. Same CLI, same output.
- **Automatic fallback**: tries the last-known-good provider/key first; on
  failure (`401/403/5xx`), burns the key, tries the next; if all keys of a
  provider are burned, falls over to the other provider.
- **Multi-key per provider**: store an array of keys per provider; rotation
  happens transparently. Burned keys auto-reset on the first day of the
  next calendar month (assuming monthly billing).
- **Zero MCP, zero runtime deps**: `bash` + Node 18+. No SDKs.
- **Predictable JSON envelope**: `--json` returns the same shape regardless
  of which provider answered. `--raw-json` exposes the provider response
  for debugging.
- **Cost guardrails**: commands estimated above 10 credits are blocked
  unless `--confirm-expensive` is passed.
- **Local cache + usage ledger** under `~/.cache/surf/`.
- **Capability-aware routing**: `crawl` and `map` are Tavily-only; the
  connector will tell you (and exit with a clear message) when no eligible
  provider has a usable key.

---

## Supported environments

| Environment | How `surf` is discovered |
|---|---|
| **Pi Coding Agent** | Install as a Pi package from git, or use `skills/surf/` directly |
| **OpenCode** | `~/.agents/skills/surf/` |
| **Claude Code** | `~/.claude/skills/surf/` |
| **Codex CLI** | `~/.codex/skills/surf/` |
| **GitHub Copilot CLI** | `~/.agents/skills/surf/` (or `~/.copilot/skills/surf/`) |

The installer creates all four symlinks automatically.

---

## Install

```bash
git clone https://github.com/frederico-kluser/tavily-skill.git
cd tavily-skill
bash skills/surf/install.sh
```

The installer:

1. Verifies Node 18+.
2. Symlinks `bin/surf.mjs` to `~/.local/bin/surf` (and adds `~/.local/bin`
   to `PATH` in your shell rc).
3. Symlinks `skills/surf/` into the four harness paths above.
4. Removes legacy `tavily`/`tvly` symlinks from a previous install.
5. Creates `~/.config/surf/keys.json` (`chmod 600`) if missing.
6. Seeds `TAVILY_API_KEY` / `PARALLEL_API_KEY` from env vars (if set) into
   `keys.json`, then asks you to remove them from your shell rc — surf
   does **not** read env vars at runtime.
7. Configures OpenCode bash-tool timeouts to 10 min.
8. Runs a smoke test (`surf --version`, `surf keys list`, optional live
   search if a key is configured).

### Pi Coding Agent

```bash
pi install https://github.com/frederico-kluser/tavily-skill
```

---

## Configuring keys

```bash
# Tavily — get one at https://app.tavily.com (1,000 free credits/month)
surf keys add --provider tavily tvly-...

# Parallel AI — get one at https://platform.parallel.ai
surf keys add --provider parallel <key>

# Inspect (keys are masked)
surf keys list

# Remove
surf keys remove --provider tavily 0

# Un-burn all keys (force retry)
surf keys reset [--provider tavily]

# Nuke everything (destructive)
surf keys clear --all --yes
```

Multiple keys per provider are supported — just `surf keys add` again with a
different key. Rotation is automatic on failure.

---

## Usage examples

### Search

```bash
surf search "latest JavaScript framework trends" --depth basic --max 5
```

### Extract known URLs

```bash
surf extract https://docs.tavily.com/documentation/api-reference/introduction
```

### Map a documentation site (Tavily only)

```bash
surf map https://docs.tavily.com --limit 50
```

### Crawl a focused subset of a site (Tavily only)

```bash
surf crawl https://docs.tavily.com \
  --select-paths "/documentation/.*" \
  --exclude-paths "/blog/.*" \
  --chunks 3
```

### Start deep research

```bash
JOB=$(surf research-start "compare search APIs for coding agents" --model pro --confirm-expensive --json | jq -r .data.request_id)
surf research-poll "$JOB"
```

### Inspect usage

```bash
surf cost              # per-provider breakdown
surf cost --json
surf cost --reset
```

### Force a specific provider (debug only)

```bash
surf search "topic" --provider parallel --max 3
```

This disables fallback — failure on the chosen provider returns a failure.

---

## Cost and safety behavior

- **Start cheap by default**: `basic` depth, small result sets.
- **Guardrails for expensive calls**: anything estimated above 10 credits
  requires `--confirm-expensive` or `SURF_ALLOW_EXPENSIVE=1`.
- **Synchronous `pro`/`ultra` research is blocked**: use
  `research-start` + `research-poll`.
- **Cache enabled by default**: response cache lives in `~/.cache/surf/`.
- **Usage ledger enabled**: per-provider breakdown in
  `~/.cache/surf/usage.jsonl`.
- **Web content is treated as untrusted input**: prints, never executes.

---

## Repository layout

```text
.
├── package.json
├── README.md
├── LICENSE
└── skills/
    └── surf/
        ├── SKILL.md
        ├── install.sh
        ├── bin/
        │   └── surf.mjs
        ├── lib/
        │   ├── state.mjs
        │   ├── cache.mjs
        │   ├── audit.mjs
        │   ├── flags.mjs
        │   ├── cost.mjs
        │   ├── format.mjs
        │   ├── dispatch.mjs
        │   ├── keys-cmd.mjs
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

- **No real API keys** in this repository.
- **Keys are stored only** in `~/.config/surf/keys.json` (chmod 600). Surf
  does not read keys from env at runtime.
- **Audit/usage logs never contain the key** — only provider name and key
  INDEX.
- `surf keys list` masks every key (`tvly-…ab12`).
- Review any skill before installing — skills can instruct agents to run
  commands.

---

## License

MIT
