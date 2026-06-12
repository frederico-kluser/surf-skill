# surf-plan-skill workflow — deeper docs

This file expands on the 6-phase workflow defined in `SKILL.md`. It's
for humans reviewing the methodology, not for the agent (which only
reads SKILL.md).

## The research gate (v4.1.0)

The skill's core invariant: **no plan reaches the user — through any
channel — without completed web research.** "Any channel" covers the
plan file, chat text, and crucially the plan-approval tools of agent
harnesses (Claude Code's `ExitPlanMode` and equivalents).

This was added because the v4.0.x skill had a hole: its only research
mechanism was the `surf-search-skill` CLI via the Bash tool, and
harness plan modes (the very modes that present a plan for approval)
typically **block Bash entirely**. The agent would trigger the skill,
find Bash blocked, silently skip research, and present an unresearched
plan for approval — defeating the skill's whole purpose.

The gate is enforced three ways, following Anthropic's skill-authoring
best practices (verifiable intermediate outputs + checklists):

1. A **progress checklist** the agent copies into its response and
   updates as it works — skipped phases are visible to the user.
2. A **Research Ledger** section required in every plan: one row per
   query (phase, layer, query string, which footnotes used it). Every
   Decision footnote must trace to a ledger row.
3. **Layered fallback** (below) so "the tool was blocked" is never a
   reason to skip — there is always a defined next step.

## Research layers

| Layer | Mechanism | When |
|---|---|---|
| A | `surf-search-skill` CLI via Bash | Default. Multi-provider, key rotation, batching. |
| B | Harness-native `WebSearch` / `WebFetch` | Bash unavailable, denied, or blocked by mode (plan mode); CLI missing or all keys burned. |
| C | None | Halt: user explicitly chooses between aborting and an "NOT WEB-RESEARCHED"-labeled plan. |

The layer is resolved in Phase 0 and recorded in the ledger. Mid-flow
Layer A failures (burned key, timeout, denied call) downgrade to B for
the remaining calls — research never silently stops.

## Plan-approval modes (Claude Code plan mode)

Claude Code's plan mode allows Read, Glob, Grep, WebSearch, WebFetch,
and AskUserQuestion, but blocks Bash, Write, and Edit. The skill's
behavior there:

- Phases 0–5 run **before** `ExitPlanMode`, using Layer B for all
  searches (WebSearch/WebFetch are read-only and permitted).
- The plan submitted for approval embeds Decisions-with-citations and
  the Research Ledger — the user approves evidence, not vibes.
- The plan **file** is written immediately after approval, when Write
  is unblocked.

## The 6 phases

### Phase 0 — resolve the research layer

Why: the old behavior ("halt if `surf-search-skill --version` fails")
was brittle — it turned every Bash restriction into a dead end, which
agents resolved by abandoning the skill. Now Phase 0 picks the best
available layer and only Layer C (nothing at all) halts, with the user
making the call.

How: try `surf-search-skill --version` via Bash → Layer A. Bash
blocked/missing → check for WebSearch/WebFetch → Layer B. Neither →
Layer C.

### Phase 1 — project discovery

Why: plans that skip this duplicate existing code. ~5 minutes of
reading saves hours of integration pain.

How:
1. `CLAUDE.md`, `AGENTS.md`, `README.md` — house style + constraints.
2. Package manifest — language, framework, deps.
3. Glob the source tree (2 levels deep).
4. Identify 2–3 existing patterns / utilities the new feature should
   reuse.
5. Note relevant configs (eslint, tsconfig, docker, ci).

Output: agent's mental model of "what already exists" + file paths.

### Phase 2 — baseline web research

Why: ground the plan in 2026 best practices, not 2024 training data.

How: ONE batched `surf-search-skill search` with 3 queries (Layer A)
or the same 3 queries as parallel WebSearch calls (Layer B). Distill:
- 3 dominant approaches
- 2–3 common mistakes
- 1–2 security/performance gotchas

Cost (Layer A): ~6 credits (Tavily) + ~10 s. Acceptable for any
non-trivial plan.

### Phase 3 — open the conversation

Why: the user needs to see you've done your homework before they
answer questions.

How: ≤8 lines. What you read + what the web says + how many questions
you have.

### Phase 4 — clarifying questions

Why: even after research, certain decisions require the user's
preference (e.g., "Redis or Postgres for the queue?", "do we need
multi-tenancy from day one?").

How:
- For each question: targeted `surf-search-skill search --max 2`
  (Layer A) or one WebSearch call (Layer B) first.
- AskUserQuestion with options informed by the search.
- Max 5 total.

Anti-pattern: asking the user to choose between options that the agent
just made up. Search first; pick options from real approaches.

### Phase 5 — synthesis research

Why: verify the user's choices against the very-latest state of the
art. Catches "you chose X but X v2 dropped support for Y last month".

How: ONE batched search with the user's chosen approach. ~6 credits.
If contradictions appear, flag them BEFORE writing the plan.

After Phase 5 the gate opens — and only after.

### Phase 6 — deliver the plan

Why: a plan file is a contract. It's reviewable, executable, and
auditable. Chat history is none of those.

How: Markdown with the structure from SKILL.md. Required sections:
Context, Decisions, Files, Steps, Verification, **Research ledger**,
References. In plan-approval modes, the same content goes to the
approval tool first and the file is written right after approval.

Citations use Markdown footnote syntax `[^N]: [Title](URL)` — renders
in GitHub, GitLab, Bitbucket, Cursor, Plannotator, and most other
viewers.

## Cost discipline

A typical plan uses (Layer A):
- 1 batch (Phase 2): 3 queries, ~6 credits, ~10 s
- 3–5 targeted (Phase 4): 1 query each, ~5 credits, ~3 s each
- 1 batch (Phase 5): 2–3 queries, ~5 credits, ~8 s

Total: ~15–20 credits, ~30 s of network time. On Tavily free tier
(1k credits/month), that's ~50 plans per month for free. Layer B costs
nothing from the surf budget (the harness pays for its own WebSearch).

## Anti-patterns explained

**Approval before research**
Presenting a plan via the approval tool and promising to "research
during implementation" inverts the skill: approval exists so the user
reviews a researched plan. The gate + ledger make this visible.

**"Bash was blocked, so I skipped the searches"**
A blocked layer is the trigger to use the next layer, never to skip.
This was the v4.0.x failure mode in plan mode.

**Fabricated ledger**
Queries the agent never ran / URLs it never saw. Worse than no plan —
it forges the evidence the user approves. The ledger maps footnotes to
queries precisely so this is auditable.

**Verbose research summary section**
A "Research Findings" section dumping every URL with snippet is noise
— it inflates the plan, distracts the executor, and ages instantly.
Synthesize: the plan has Decisions with footnotes + a compact ledger;
that's the research's role in the final document.

**Aesthetic questions**
"What color theme?" / "Should we name it FooBar or BarFoo?" — these
aren't planning questions. Defer to the execution phase.

**Single-source citations**
If every decision footnotes the same URL, the research was shallow.
Diversify: aim for 1 citation per major source category (vendor docs,
community blog, security advisory, benchmark, etc.).

**Plans without file paths**
"Update the controller layer" is not a plan, it's a wish. Phase 1
exists so the plan can say `src/controllers/user.ts:42`.

**Surveys (>5 questions)**
Beyond 5 questions, the user fatigues and starts answering "whatever".
If you genuinely need more, the task is too big — slice it.

## Plan file conventions

- File name: `<slug>-<YYYYMMDD-HHMM>.md`. Slug is kebab-case, ≤50 chars.
- Slug collision: append `-2`, `-3`, etc.
- Title in `# Plan: ...` matches the slug.
- Footnote order: in the order they're first cited.
- URLs: full https links, no trackers or auth tokens.
- Code references: `path/to/file.ext:LINE` format, parseable by most IDEs.

## What surf-plan-skill is NOT

- Not an execution engine. Once the plan is written, hand it to another
  tool/agent/human.
- Not a project manager. It's per-task, not multi-task.
- Not a code generator. It writes a plan, not code.
- Not a replacement for Plan Mode. Plan Mode is the harness's
  interactive approval flow; surf-plan-skill is the research+evidence
  methodology that runs *inside* it (Layers make that possible). They
  complement.
