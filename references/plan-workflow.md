# surf-plan workflow — deeper docs

This file expands on the 6-phase workflow defined in `SKILL.md`. It's
for humans reviewing the methodology, not for the agent (which only
reads SKILL.md).

## The 6 phases

### Phase 0 — preflight

Why: if `surf-skill` is missing, web research is impossible, and the
plan would just be the agent's training-time hallucinations dressed up
in markdown. Halt is the right move.

How: `surf-skill --version` exits 0 → continue. Exits non-zero or
command not found → halt with install instructions.

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

How: ONE batched `surf-skill search` with 3 queries. Distill:
- 3 dominant approaches
- 2–3 common mistakes
- 1–2 security/performance gotchas

Cost: ~6 credits (Tavily) + ~10 s. Acceptable for any non-trivial plan.

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
- For each question: targeted `surf-skill search --max 2` first.
- AskUserQuestion with options informed by the search.
- Max 5 total.

Anti-pattern: asking the user to choose between options that the agent
just made up. Search first; pick options from real approaches.

### Phase 5 — synthesis research

Why: verify the user's choices against the very-latest state of the
art. Catches "you chose X but X v2 dropped support for Y last month".

How: ONE batched search with the user's chosen approach. ~6 credits.
If contradictions appear, flag them BEFORE writing the plan.

### Phase 6 — write the plan

Why: a plan file is a contract. It's reviewable, executable, and
auditable. Chat history is none of those.

How: Markdown with the structure from SKILL.md. Required sections:
Context, Decisions, Files, Steps, Verification, References.

Citations use Markdown footnote syntax `[^N]: [Title](URL)` — renders
in GitHub, GitLab, Bitbucket, Cursor, Plannotator, and most other
viewers.

## Cost discipline

A typical plan uses:
- 1 batch (Phase 2): 3 queries, ~6 credits, ~10 s
- 3–5 targeted (Phase 4): 1 query each, ~5 credits, ~3 s each
- 1 batch (Phase 5): 2–3 queries, ~5 credits, ~8 s

Total: ~15–20 credits, ~30 s of network time. On Tavily free tier
(1k credits/month), that's ~50 plans per month for free.

## Anti-patterns explained

**Verbose research summary section**
A "Research Findings" section dumping every URL with snippet is noise
— it inflates the plan, distracts the executor, and ages instantly.
Synthesize: the plan has Decisions with footnotes; that's the
research's role in the final document.

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

## What surf-plan is NOT

- Not an execution engine. Once the plan is written, hand it to another
  tool/agent/human.
- Not a project manager. It's per-task, not multi-task.
- Not a code generator. It writes a plan, not code.
- Not a replacement for Plan Mode. Plan Mode is more interactive but
  ephemeral and without web research. They complement.
