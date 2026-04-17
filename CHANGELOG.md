# Changelog

All notable changes to `@lcm2m/caddis-mcp` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/). Pre-1.0 releases may
include breaking changes in minor bumps; post-1.0, breaking changes bump major.

## [Unreleased]

## [0.2.0] - 2026-04-17

### Added

- **`caddis_batch` tool** — run up to 20 other `caddis_*` tools in a single call,
  fanned out in parallel. Each request is dispatched to the same handler the tool
  would run individually, so existing auth, 429 retry/jitter, and single-flight
  login behavior applies per request with no duplication. Response is one text
  block per request, in input order, prefixed with `#<index> <tool> <ok|error>`.
  Per-entry errors (unknown tool, arg validation failure, 5xx, thrown errors) are
  isolated so one failure doesn't sink the batch; `AuthMissingError` and
  `CompanySelectionRequiredError` still surface top-level.
- **`CADDIS_BATCH_CONCURRENCY`** env var — caps in-flight requests within a batch
  (default 5, clamp 1–10). Backend is 60 req/10s/user, so 5 leaves headroom for
  429 retries inside each entry.
- **`ToolHandlerRegistry`** (`src/tools/registry.ts`) — internal registry that
  stores each tool's compiled zod input schema and handler alongside the SDK's
  own registration, so `caddis_batch` can look up handlers by name and validate
  args per entry. Paired with a lightweight inline semaphore (`createLimiter`)
  kept in the same module — no new runtime dependencies.

### Changed

- Each `register*Tools(server, client)` function now takes a `ToolHandlerRegistry`
  as a third argument and registers through a new `registerTool` helper that
  populates both the SDK and the registry at once. Internal refactor; no change
  to the public tool surface.
- Test suite grew to 61 tests with dedicated coverage for the registry,
  concurrency limiter, and batch dispatch (unknown tool, validation failure,
  per-entry 5xx isolation, concurrency cap, batch size limits, nested-batch
  rejection, credential-error propagation).

## [0.1.0] - 2026-04-17

Initial release. Wraps the LCM2M Caddis VMCP API as an MCP server for LLM-based tools
like Claude Desktop, Claude Code, and Cursor.

### Added

- **Tool coverage** — one MCP tool per VMCP route across company, devices, equipment
  (and sub-resources: utilization, schedule, cycles, statuslogs, telemetry, shift
  history, excessive-downtime events), org units + tree, alarms, tags, tag groups,
  runs, and status reasons.
- **`CaddisApiClient`** — dual-API client exposing `vmcp()`, `v1()`, and `v1Json<T>()`
  over a single shared auth / retry / rate-limit layer. Builds query strings with
  `[]` suffix fan-out for array-valued keys (required by the backend's
  `multiValueQueryStringParameters` handling).
- **Auto-login with JWT caching** — on first request, POSTs
  `{username, password, company_id?}` to `/vmcp/sessions`, caches the JWT and its
  decoded `exp`, and proactively re-logs in 30 seconds before expiry. Single-flight
  login dedup prevents parallel requests from triggering multiple logins.
- **401 re-login retry** — clears the token cache and retries the request once with
  a fresh token.
- **429 retry loop** — parses `Retry-After` (falls back to `X-RateLimit-Reset-*`),
  applies ±20% jitter, retries up to `CADDIS_MAX_RETRIES` times, caps total wait
  per request at `CADDIS_MAX_RETRY_WAIT_MS`. Surfaces the 429 as an `isError: true`
  tool result when retries exhaust.
- **Low-remaining rate-limit warnings** — logs to stderr when
  `X-RateLimit-Remaining-{endpoint,user}` drops to ≤ 3 after a successful request.
- **CSV/YAML body passthrough** — VMCP responses are returned verbatim as `text`
  content so token usage stays cheap (CSV for uniform rows, YAML for nested/variable).
- **Composite-tool seam** — `src/tools/composite/index.ts` provides a registration
  function for higher-level tools that aren't 1:1 VMCP wrappers and may compose
  multiple vmcp/v1 calls.
- **Configuration via env vars** — `CADDIS_API_URL`, `CADDIS_USERNAME`,
  `CADDIS_PASSWORD`, `CADDIS_COMPANY_ID`, `CADDIS_MAX_RETRIES`,
  `CADDIS_MAX_RETRY_WAIT_MS`.
- **Distribution paths** — published to npm as `@lcm2m/caddis-mcp` (invocable via
  `npx -y @lcm2m/caddis-mcp`). Multi-stage `Dockerfile` produces a slim Node 25
  runtime image; `npm run docker:build` is the shortcut.
- **Test suite** — 38 tests using Node's built-in test runner via `tsx --test`.
  Tier 1 covers pure helpers (`buildQueryString`, `parseRetryWaitMs`, `applyJitter`,
  `decodeJwtExp`, `runTool`). Tier 2 covers the client via injected `fetch`: lazy
  login + cache, 401 re-login, 429 retry / exhaust / budget-cap, concurrent login
  dedup, JWT expiry, `CompanySelectionRequiredError`, and body passthrough.

[Unreleased]: https://github.com/LCM2M/lcm2m-caddis-mcp/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/LCM2M/lcm2m-caddis-mcp/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/LCM2M/lcm2m-caddis-mcp/releases/tag/v0.1.0
