# ui-snapshot-engine

`ui-snapshot-engine` turns web pages into durable visual snapshots and optional structured page data.

It runs three replaceable stages:

1. **Capture**: opens each route in headless Chromium, waits for the page to settle, and captures the full page as overlapping PNG tiles.
2. **Prepare**: writes the tiles and metadata to a predictable local directory and creates a run manifest.
3. **Extract**: sends all tiles for a route, in order, to a vision model and returns schema-validated JSON.

The engine is useful for visual inventory, design-system audits, content migration, page indexing, QA fixtures, and downstream UI analysis. Capture works without an API key; only the extraction stage requires a model implementation.

```ts
import { snapshot, analyze, GeminiExtractor } from "ui-snapshot-engine";

// Capture + prepare only
const run = await snapshot({
  baseUrl: "http://localhost:3000",
  routes: ["/", "/pricing"],
});

// Capture + prepare + extract
const { run, extractions } = await analyze({
  baseUrl: "http://localhost:3000",
  routes: ["/", "/pricing"],
  extractor: new GeminiExtractor(), // GEMINI_API_KEY
});
```

`routes` may be relative paths such as `"/pricing"` or absolute URLs. Duplicate routes are removed while input order is preserved. A route failure does not abort the rest of the run.

## Setup

```bash
npm install
npx playwright install chromium
export GEMINI_API_KEY=...       # macOS/Linux; use $env:GEMINI_API_KEY=... in PowerShell
npm test            # unit + pipeline tests; browser tests auto-skip without Chromium
npm run example
```

`GeminiExtractor` also reads `GOOGLE_API_KEY`, and loads a local `.env` file. Pass `apiKey` explicitly when environment configuration is not appropriate. The default model is `gemini-3.8-flash` and can be changed with `model`.

## Capture behavior

The default Playwright capturer:

- uses a headless Chromium context with the requested viewport and device scale factor;
- disables animations, transitions, smooth scrolling, and the caret for stable images;
- waits for navigation, then best-effort waits for network idle, fonts, images, lazy images, scroll-triggered content, and stable document height;
- captures tall pages as vertically overlapping tiles so content at a boundary is visible in both neighboring images;
- records warnings when settling is incomplete;
- truncates pages above `maxPageHeight` and marks the result with `truncated: true`;
- checks HTTP status codes by default (`failOnHttpError: true`).

Settling is best effort: a page can still succeed with warnings when it keeps changing or some resources never finish loading.

## Snapshot options

```ts
await snapshot({
  baseUrl: "http://localhost:3000",
  routes: ["/", "/pricing"],
  viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  tile: { maxHeight: 3000, overlap: 300 },
  outDir: ".snapshots",
  maxPageHeight: 40_000,
  navigationTimeoutMs: 30_000,
  settleTimeoutMs: 10_000,
  failOnHttpError: true,
  concurrency: 1,
});
```

All fields have defaults. `viewport.width` and `height` allow 200-4000 CSS pixels; `deviceScaleFactor` allows 1-3. Tile height allows 500-8000 CSS pixels, and overlap must be less than half the tile height. Route capture concurrency is bounded from 1 to 8.

## Output layout

```
.snapshots/
  manifest.json            # whole run: summary + every page result
  pricing/
    snapshot-1.png
    snapshot-2.png
    metadata.json          # route, page size, per-snapshot startY/endY/overlap/pixel size
```

`manifest.json` contains the run timestamps, absolute output directory, `{ total, ok, failed }` summary, and one result for each route. Each successful page result includes the requested URL, final URL after redirects, title, page dimensions, viewport, warnings, truncation state, and ordered snapshot metadata. Each PNG is named `snapshot-N.png`; route directories are sanitized and made unique when routes would collide.

The extraction result is returned from `analyze()` and is not written to the snapshot directory automatically. Persist it separately if it is part of an application data pipeline.

## Layers (each replaceable)

| Layer   | Contract                   | Default               |
| ------- | -------------------------- | --------------------- |
| Capture | `PageCapturer`             | Playwright + Chromium |
| Prepare | `persistPage`, `planTiles` | local filesystem      |
| Extract | `Extractor`                | `GeminiExtractor`     |

Inject a custom capturer for another browser, a remote rendering service, or tests:

```ts
const run = await snapshot(options, {
  capturer: {
    async capture(request) {
      // Return a CapturedPage with PNG tile buffers and position metadata.
    },
    async close() {},
  },
});
```

Implement `Extractor` to use another vision provider. It receives the route, page dimensions, title, and ordered PNG buffers with each tile's Y-range and overlap. `extractPages(pages, extractor, { concurrency })` can also be used when capture and extraction are separate jobs.

## Structured extraction

`GeminiExtractor` makes one request per route and sends every tile in top-to-bottom order. The response is constrained to `PageExtractionSchema` and includes:

- page type, visible title, and a short summary;
- ordered sections such as hero, plans, features, FAQs, tables, forms, galleries, and footer;
- page and section actions with labels, types, and optional targets;
- pricing, items, badges, features, and primary item actions;
- forms and fields, primary and secondary navigation;
- named entities and relationships such as products, plans, companies, and requirements;
- an `uncertainties` list for content that is cut off, unreadable, or ambiguous.

Fields are required by the model schema, with `null` or `[]` representing information that is absent or not visible. Use `PageExtractionSchema` for runtime validation or `extractionJsonSchema()` when integrating another constrained-decoding provider.

Gemini requests are guarded by `maxSnapshotsPerRequest` (default 12) and `maxInlineBytes` (default 18 MiB). Invalid JSON/schema output is retried with the validation problem; transient network errors and HTTP 429/5xx responses are retried with exponential backoff.

## Failure model

`snapshot()` and `extractRoute()` never throw for per-route problems. They return a failed result with `{ route, status: "failed", error: { code, message } }`. In extraction results, `stage` identifies whether the failure came from capture or extraction.

Possible error codes are:

| Code                    | Meaning                                                                   |
| ----------------------- | ------------------------------------------------------------------------- |
| `INVALID_INPUT`         | Options or route resolution are invalid. Invalid top-level options throw. |
| `BROWSER_LAUNCH_FAILED` | Chromium could not start, commonly because it is not installed.           |
| `NAVIGATION_TIMEOUT`    | A route did not load within `navigationTimeoutMs`.                        |
| `NAVIGATION_FAILED`     | Navigation failed for another browser/network reason.                     |
| `HTTP_ERROR`            | The route returned HTTP 400 or higher while `failOnHttpError` is enabled. |
| `CAPTURE_FAILED`        | Screenshot or browser capture failed.                                     |
| `STORAGE_FAILED`        | Snapshot files or metadata could not be written.                          |
| `NO_API_KEY`            | `GeminiExtractor` has no API key and no injected client.                  |
| `INPUT_TOO_LARGE`       | Extraction exceeded its tile-count or inline-byte limit.                  |
| `EXTRACTION_FAILED`     | The model request or extraction input failed.                             |
| `INVALID_MODEL_OUTPUT`  | The model exhausted retries without returning schema-valid JSON.          |

## Design decisions

- **Multi-snapshot pages → one LLM call.** All tiles are sent in order, each labelled with its Y-range and overlap, so the model sees one continuous document. No merge/dedupe code needed; cost is bounded by `maxSnapshotsPerRequest` (default 12).
- **Schema fields are required-but-nullable** (`null` / `[]` = absent) for reliable constrained decoding.
- **Invalid model output** triggers a retry that tells the model what was wrong; transient API errors (429/5xx) retry with backoff.
