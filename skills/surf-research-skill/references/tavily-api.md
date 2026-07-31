# Tavily API — endpoint reference

Base: `https://api.tavily.com`. Auth: `Authorization: Bearer tvly-…`.

## POST /search
Search the web.

| Field | Type | Notes |
|---|---|---|
| `query` | string | required |
| `search_depth` | `basic` \| `advanced` \| `fast` \| `ultra-fast` | default `basic` |
| `max_results` | int | ≤20 |
| `topic` | `general` \| `news` \| `finance` | |
| `time_range` | `day` \| `week` \| `month` \| `year` | |
| `start_date`, `end_date` | ISO date | |
| `include_domains` | string[] | ≤300 |
| `exclude_domains` | string[] | ≤150 |
| `include_answer` | `false` \| `basic` \| `advanced` | |
| `include_raw_content` | `false` \| `markdown` \| `text` | |
| `include_images`, `include_image_descriptions`, `include_favicon` | bool | |
| `country` | string | only with `topic=general` |
| `auto_parameters` | bool | always 2 credits |
| `exact_match` | bool | |
| `include_usage` | bool | include credit usage in response |

## POST /extract
Pull content from known URLs.

| Field | Type | Notes |
|---|---|---|
| `urls` | string[] | up to 20 |
| `extract_depth` | `basic` \| `advanced` | |
| `format` | `markdown` \| `text` | |
| `include_images`, `include_favicon` | bool | |
| `query` | string | filter relevance |
| `chunks_per_source` | 1–5 | |
| `timeout` | float | 1.0–60.0 s |

## POST /crawl
Mapping + extraction starting from a URL.

| Field | Type | Notes |
|---|---|---|
| `url` | string | required |
| `max_depth`, `max_breadth`, `limit` | int | |
| `instructions` | string | natural language guidance |
| `select_paths`, `select_domains` | string[] | regex |
| `exclude_paths`, `exclude_domains` | string[] | |
| `allow_external` | bool | |
| `include_images` | bool | |
| `categories` | string[] | |
| `extract_depth` | `basic` \| `advanced` | |
| `format` | `markdown` \| `text` | |
| `query` | string | optional focus filter |
| `chunks_per_source` | 1–5 | |
| `timeout` | float | custom server-side timeout |
| `include_usage` | bool | include credit usage in response |

## POST /map
Discover URLs without extracting (cheaper).

Same selection fields as crawl, no `extract_depth`. API also supports `timeout` and `include_usage`.

## POST /research
Start an async research job.

| Field | Type | Notes |
|---|---|---|
| `input` | string | required |
| `model` | `mini` \| `pro` \| `auto` | |
| `stream` | bool | SSE |
| `output_schema` | JSON Schema | |
| `citation_format` | `numbered` \| `mla` \| `apa` \| `chicago` | |

Returns `{ request_id, status: "pending", model }` quickly.

## GET /research/{request_id}
Poll a research job. Free.

Returns `{ status: "pending" | "completed" | "failed", content, sources }`.

## GET /usage
Account usage. Free.

## Status codes

- `200` ok
- `401` bad/missing key
- `429` rate limit (retry with backoff)
- `432`, `433` plan/quota limits — escalate to user

## Best practices (from Tavily's own guidance)

- **Keep queries under ~400 characters.** Write it like a search query, not
  a long-form prompt.
- **Break complex/multi-topic questions into separate focused queries**
  rather than one query trying to cover everything — this is exactly what
  `search-parallel`/`search` batching already does; keep doing it.
- **`search_depth` trades latency for relevance**: `ultra-fast` (lowest
  latency, lower relevance, content) < `fast` (low latency, good relevance,
  chunks) < `basic` (medium latency, high relevance, content) < `advanced`
  (highest latency, highest relevance, chunks).
- **Chunks vs content**: chunks are short, reranked snippets — use them when
  you need something specific aligned to the query (`fast`/`advanced`).
  Content is an NLP summary of the whole page — use it when a general read
  is enough (`basic`/`ultra-fast`).
- **`exact_match`** (query wrapped in quotes) narrows to a verbatim
  name/phrase — use for due diligence, entity resolution, compliance
  lookups; not for open questions (it can return empty on a non-exact hit).
- **Two-step depth**: `search` to find URLs, then `extract` the 1-3 best
  ones. Snippets alone are rarely enough to cite a claim confidently.
- **`auto_parameters=true` always costs 2 credits**, even when it picks
  `basic` internally — set `search_depth` explicitly to control cost.
- Source: <https://docs.tavily.com/documentation/best-practices/best-practices-search>.
