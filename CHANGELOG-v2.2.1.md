# surf-skill v2.2.1 — Parallel search body fix

## Bug

`surf-skill search --provider parallel "..."` always returned

```
❌ Error: Request validation error.
```

because `lib/providers/parallel.mjs::search()` was sending extra fields
(`processor`, `max_results`, `source_policy`) that `POST /v1/search`
rejects with `"Extra inputs are not permitted"`. Verified live against
`api.parallel.ai` on 2026-05-20: the endpoint currently accepts ONLY
`{ objective, search_queries }`.

## Fix

- `parallel.search()` now sends exactly `{ objective, search_queries }`.
  Tavily-only knobs like `--depth`, `--max`, `--domains` are silently
  ignored on this provider (Tavily continues to honor them).
- `extractMessage()` now surfaces `body.error.detail.errors[]` from
  Parallel — each line shows the offending field path (`body.processor`)
  and the validation message. This makes future schema mismatches
  debuggable without `--raw-json`.
- Inline comment in `parallel.mjs::search()` notes the current accepted
  shape and dates the verification, so the next person to add a field
  remembers to check the spec first.

## Files changed

- `skills/surf-skill/lib/providers/parallel.mjs` — search body + error
  extractor.
- `package.json`, `skills/surf-skill/SKILL.md`,
  `skills/surf-skill/bin/surf-skill.mjs`,
  `skills/surf-skill/lib/dispatch.mjs` — version bump 2.2.0 → 2.2.1.

## Verification

Live, in an isolated `$HOME`, with real Tavily and Parallel keys:

- `surf-skill search "Q" --provider tavily --max 1` → 200, 1 result.
- `surf-skill search "Q" --provider parallel` → 200, results from Parallel.
- `surf-skill search "Q1" "Q2" --provider tavily --max 1` → batch 2/2 OK.
- `surf-skill search "Q1" "Q2" --provider parallel` → batch 2/2 OK.
- `surf-skill search "Q1" "Q2"` (no `--provider`) → auto-routes via
  `last_ok_provider`, both queries OK.

No breaking change; this is a strict bug fix.
