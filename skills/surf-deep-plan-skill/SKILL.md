---
name: surf-deep-plan-skill
description: >-
  Ambiguity-exhaustive, research-grounded planning. BEFORE proposing any plan it
  (1) enumerates EVERY ambiguity as a structured clarifying question and (2)
  grounds every option in real parallel research — never invents options. Use
  this when the user explicitly wants all doubts surfaced first, or for
  high-stakes / vague / hard-to-reverse work: "raise all my doubts first",
  "exhaustive plan", "don't start until everything is clear", "surface every
  unknown", "ambiguity sweep". Gatilhos em português: "levante todas as dúvidas",
  "tire todas as dúvidas antes", "plano exaustivo", "não comece até esclarecer
  tudo", "mapeie todas as incertezas". For a STANDARD research-grounded plan
  (most "make a plan" / "faça um plano" requests), use surf-plan-skill instead —
  this skill front-loads a full ambiguity sweep and costs more interaction.
  Tuned for no-timeout harnesses (Pi core) via --no-budget.
license: MIT
argument-hint: "<the thing to plan / build / change, when every doubt must be raised first>"
allowed-tools: Bash(surf-search-skill:*), Bash(surf-plan-skill:*), Read, Glob, Grep, Write, Edit, WebSearch, WebFetch, AskUserQuestion
metadata:
  version: "4.2.0"
  requires: "node>=18; surf-search-skill in PATH (npm i -g surf-skill) for Layer A research; harness WebSearch/WebFetch as Layer B fallback; plan dir at ~/.claude/plans/ (or ./plans/ if present). On Pi core pass --no-budget for wide research calls."
---

# surf-deep-plan-skill — ambiguity-exhaustive, research-grounded planning

You produce execution plans that are (a) grounded in real research and (b)
preceded by a **complete enumeration of every ambiguity**. You never guess a
requirement you could ask about, and you never present an option you have not
verified. This is `surf-plan-skill` with a mandatory, front-loaded **ambiguity
sweep** — use it when the cost of a wrong assumption is high.

> Relationship to surf-plan-skill: same research gate, ledger, layers, and plan
> template. The difference is Phase 3 (AMBIGUITY SWEEP) and a second gate lock.
> If the user just wants a normal plan, defer to **surf-plan-skill**.

## THE GATE — two locks (read before anything else)

1. **Ambiguity lock:** you MUST NOT propose a plan until ALL ambiguities are
   enumerated in the Ambiguity Register and each is either (a) answered by the
   user or (b) resolved by research and explicitly marked ASSUMPTION. *Todas as
   dúvidas devem ser levantadas.*
2. **Research lock:** you MUST NOT propose a plan until the Research Ledger has a
   sourced entry for every phase-relevant unknown — and every clarifying OPTION
   you present traces to a ledger source. No ungrounded options.

A plan reaches the user through ANY channel — chat, a plan file, or a
plan-approval tool (`ExitPlanMode`/equivalent). All channels are behind both
locks. **While the gate is closed, only read / research / ask — do not Write or
Edit project files.** The plan file itself is written *after* the gate opens
(in plan-approval mode, after approval).

## Research layers (resolve once in Phase 0)

Use the FIRST that works; a blocked layer means fall back, never skip.

- **Layer A — `surf-search-skill` CLI via Bash (preferred).** Multi-provider,
  key rotation, parallel fan-out, citations.
- **Layer B — harness-native WebSearch/WebFetch.** When Bash is denied/blocked
  (e.g. plan mode) or the CLI is missing. Run the same queries as WebSearch
  calls; WebFetch the load-bearing pages.
- **Layer C — nothing available.** Tell the user no web research is possible and
  let them decide; an unresearched plan must be labeled **NOT WEB-RESEARCHED**.

On **Pi core (no bash timeout)**, add `--no-budget` to wide research calls so the
connector doesn't self-abort at its 30 s worst-case guess. On time-limited
harnesses, omit it (you want the self-abort) and keep calls under the ceiling.

## Progress checklist (COPY into your reply; check off in order)

```text
Deep-plan progress:
- [ ] 1 RESTATE — goal, hard constraints, definition of done
- [ ] 2 RECON — read the codebase/context (Glob/Grep/Read), list what exists vs missing
- [ ] 3 AMBIGUITY SWEEP — enumerate ALL doubts by category → Ambiguity Register
- [ ] 4 GROUNDING — parallel research to back every option → Research Ledger
- [ ] 5 CLARIFY — ask highest-info questions (AskUserQuestion), 3-5 researched options each
- [ ] Gate open: ambiguity lock + research lock BOTH satisfied
- [ ] 6 PLAN — 6-section plan (only after BOTH locks open)
- [ ] 7 VERIFY — self-check plan vs ledger vs answered ambiguities
```

## Phase workflow

### Phase 1 — RESTATE
Goal, hard constraints, and a concrete definition of done in ≤5 lines.

### Phase 2 — RECON (read-only)
Use Glob/Grep/Read to map the relevant code, configs, and prior art. Read
`CLAUDE.md`/`AGENTS.md`/`README.md` and the package manifest. List 2-3 existing
patterns/utilities the work should reuse, **with file paths**. State what exists
and what's missing — this feeds the sweep.

### Phase 3 — AMBIGUITY SWEEP (the differentiator → Ambiguity Register)
Enumerate EVERY doubt. Walk a taxonomy so you miss nothing — for each category
ask "is anything here unspecified, vague, or assumed?":

- **Scope** — in/out of scope, MVP vs full
- **Architecture** — patterns, boundaries, existing conventions
- **Data** — schema, sources, volume, migration, retention
- **Security** — authn/z, secrets, untrusted input, compliance
- **Performance** — latency/throughput targets, limits
- **Deployment** — env, CI/CD, rollout, rollback
- **Constraints** — deadlines, deps, runtime versions, zero-dep?
- **Edge cases** — failure modes, empty/huge inputs, concurrency
- **Non-functional** — observability, i18n, accessibility, cost

Two detection aids that surface *real* gaps (not invented ones):
- **EARS gap test:** write each requirement as "When `<trigger>`, the system
  shall `<behavior>`." If you can't fill a clause, that clause is an ambiguity.
- **Two-implementations test (ClarifyGPT):** sketch 2 plausible implementations
  in your head; wherever they would DIVERGE is a real ambiguity to raise.

Record every doubt in the Ambiguity Register. Do not stop early — completeness
is the whole point of this skill.

### Phase 4 — GROUNDING (→ Research Ledger)
For each ambiguity whose answer depends on external facts (library behavior,
best practice, API limits, version differences), launch parallel research so
each clarifying option is backed by a real finding. Build a queries file (one
query per independent unknown × angle) and fan out:

```bash
# Pi core (no limit): add --no-budget. Time-limited harness: drop it, lower --concurrency.
surf-search-skill search-parallel --queries-file /tmp/plan-queries.json \
  --concurrency 8 --no-budget --json > /tmp/plan-research.json
```

(Layer B: emit the same queries as WebSearch calls in one turn; WebFetch the
load-bearing pages. See **surf-parallel-skill** for the full fan-out protocol.)
Every option you later present must trace to a ledger row. **Never invent
options.**

### Phase 5 — CLARIFY (→ asked questions + answers)
Turn the Register into questions and ask via **AskUserQuestion**:

- Group by category; ask the **highest-information-gain** questions first
  ("what would most change the plan?").
- Provide **3-5 concrete options** per question (3-5 beats 2), each answerable
  in a few words, each backed by a real finding from Phase 4. Mark a sensible
  DEFAULT.
- Cap one round to ~5-7 questions to avoid fatigue; batch a second round if
  needed. Items you can safely settle by research → mark ASSUMPTION (don't ask),
  and list assumptions for the user to veto.
- Single-select for mutually exclusive; multi-select for "all that apply".

### Phase 6 — PLAN (only after BOTH locks open) — 6 sections
1. **Objective & done-criteria** (Phase 1, refined by answers)
2. **Approach & architecture** (grounded; cite the ledger with `[^N]`)
3. **Work breakdown** — ordered tasks, each ≤30 min / one agent turn, with real
   file paths from Phase 2; mark which are parallelizable
4. **Risks & mitigations** (incl. resolved contradictions, flagged unknowns)
5. **Verification plan** — exact commands/tests that check each task
6. **Assumptions & open items** — every ASSUMPTION + anything still unanswered

Write the plan file (`surf-plan-skill new "<task>"` prints the correct path:
`./plans/` → `./.surf-plans/` → `~/.claude/plans/<slug>-<ts>.md`, or
`$SURF_PLAN_DIR`). In plan-approval mode, present the full plan (with the
Register + Ledger embedded) via the approval tool, then write the file as your
first post-approval action.

### Phase 7 — VERIFY (→ self-check block)
Confirm: every Register item is Answered or ASSUMPTION; every plan claim maps to
a ledger row or a user answer; no Write/Edit of project files happened before
the gate opened.

## Ambiguity Register (template — keep in your reply)

```text
| # | Category | The doubt (EARS-style gap)                              | Resolution path     | Status   |
|---|----------|---------------------------------------------------------|---------------------|----------|
| 1 | Data     | When importing, the system shall handle <?> duplicates  | ASK                 | open     |
| 2 | Security | Where secrets are stored is unspecified                 | RESEARCH→ASSUMPTION | resolved |
```

## Research Ledger (template — keep in your reply)

```text
| Unknown | Query / source | Finding | URL — date | Backs which option |
|---------|----------------|---------|-----------|--------------------|
```

## Anti-patterns (avoid)

- ❌ Proposing a plan before the Ambiguity Register is COMPLETE.
- ❌ Inventing clarifying options not backed by research.
- ❌ Asking 20 questions at once — batch and prioritize by info-gain.
- ❌ Asking what you can safely settle by research (mark it ASSUMPTION instead).
- ❌ Writing/editing project files while the gate is closed.
- ❌ Two-option questions when 3-5 give better answers.
- ❌ Ignoring publication dates / stale sources.
- ❌ Using this skill for a routine plan — that's surf-plan-skill's job.

## Quick command reference

```bash
# Parallel grounding (Pi/no-limit: add --no-budget)
surf-search-skill search-parallel --queries-file F.json --concurrency 8 --json
surf-search-skill search "<specific decision> tradeoffs 2026" --max 2 --quiet
surf-search-skill extract --urls-file U.json --depth advanced --json

# Plan file management
surf-plan-skill new "<task>"      # create skeleton at the right path + print it
surf-plan-skill list              # list existing plans
surf-plan-skill doctor            # verify surf-search-skill installed + key count

# Ask the user: AskUserQuestion with 3-5 researched options per question.
# Fallback when Bash is blocked: WebSearch/WebFetch (multiple calls in one turn).
```

## Why this skill exists

A plan built on an unspoken assumption fails exactly where the assumption was
wrong. Standard planning (surf-plan-skill) researches and cites; this skill adds
the discipline of **surfacing every doubt first** and **backing every option
with evidence** — so the user approves a plan with no hidden guesses. Reserve it
for work where that rigor pays for the extra interaction.
