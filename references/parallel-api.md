# Parallel AI — endpoint reference

Base URL: `https://api.parallel.ai`.

**Auth**: header `x-api-key: <PARALLEL_API_KEY>` (**not** `Authorization: Bearer`).

Get a key at <https://platform.parallel.ai>. Docs at <https://docs.parallel.ai>.

## POST /v1/search

Web search.

| Field | Type | Notes |
|---|---|---|
| `objective` | string | required — natural language description of what you need |
| `search_queries` | string[] | required — search queries to issue |
| `processor` | `lite` \| `base` | optional; default `lite`. `base` ≈ Tavily's `advanced` depth |
| `max_results` | int | optional |
| `source_policy.include_domains` | string[] | optional |
| `source_policy.exclude_domains` | string[] | optional |

Response:

```json
{
  "search_id": "...",
  "results": [
    {
      "url": "...",
      "title": "...",
      "excerpts": ["...", "..."],
      "publish_date": "2026-01-01"
    }
  ],
  "warnings": [],
  "usage": {}
}
```

Doc: <https://docs.parallel.ai/search/search-quickstart>

## POST /v1beta/extract  (beta)

Pull content from known URLs.

| Field | Type | Notes |
|---|---|---|
| `urls` | string[] | required |
| `objective` | string | optional — focuses extraction on specific information |
| `excerpts` | bool | optional — return objective-focused excerpts |
| `full_content` | bool | optional — return full Markdown of each page |

Response:

```json
{
  "extract_id": "...",
  "results": [
    {
      "url": "...",
      "title": "...",
      "publish_date": "...",
      "excerpts": ["..."],
      "full_content": "..."
    }
  ],
  "errors": []
}
```

Doc: <https://docs.parallel.ai/extract/extract-quickstart>

## POST /v1/tasks/runs   →  GET /v1/tasks/runs/{run_id}/result

Async Task API — Parallel's deep-research equivalent.

`POST /v1/tasks/runs` body:

| Field | Type | Notes |
|---|---|---|
| `input` | string \| object | required |
| `processor` | `lite` \| `base` \| `core` \| `pro` \| `ultra` \| `ultra8x` | required |
| `task_spec.output_schema` | JSON Schema / text / auto | optional — structured output |
| `metadata` | object | optional |

Returns **HTTP 202** with `{ run_id, status: "queued" \| "running", is_active, processor }`.

`GET /v1/tasks/runs/{run_id}` returns status only.

`GET /v1/tasks/runs/{run_id}/result` returns the result **only after `status: "completed"`**:

```json
{
  "run_id": "...",
  "status": "completed",
  "output": {
    "content": "...",
    "basis": [
      { "url": "...", "title": "..." }
    ]
  }
}
```

Processor mapping used by `surf-skill research`:

| `--model` | Parallel processor |
|---|---|
| `mini` | `lite` |
| `auto` | `base` |
| `pro` | `pro` |
| `ultra` | `ultra` |

Doc: <https://docs.parallel.ai/task-api/task-quickstart>,
<https://docs.parallel.ai/task-api/guides/choose-a-processor>

## Capabilities not provided by Parallel

- **No crawl endpoint** (no recursive site walk).
- **No URL-map endpoint** (no sitemap discovery without fetching content).
- **No public `/usage` endpoint** at the time of writing.

`surf` routes `crawl` and `map` to Tavily only.

## Error format

Non-2xx responses use:

```json
{
  "type": "error",
  "error": {
    "ref_id": "...",
    "message": "human-readable message",
    "detail": {}
  }
}
```

Surf classifies them as:

- `401` → `auth` (burn key, try next)
- `402` insufficient credits → `auth` (burn key, try next)
- `403` → `auth` **unless** body says "processor" → `caller_4xx`
- `429` → `rate_limit_429` (retry with backoff)
- `5xx` → `server_5xx` (retry; after 3 attempts, burn key)
- other 4xx → `caller_4xx` (no fallback, throw)

## Notes

- Free tier / RPS / `Retry-After` header are **not publicly documented**.
- The `parallel-web` Node SDK exists (v0.4.1) but requires Node 20+; surf
  uses `fetch` directly to stay zero-deps and Node 18+ compatible.
- Extract is in `v1beta`; the path may change. The adapter is in
  `lib/providers/parallel.mjs` if you need to update it.
