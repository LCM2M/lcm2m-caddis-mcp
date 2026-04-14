# lcm2m-caddis-mcp

An MCP (Model Context Protocol) server that exposes the LCM2M Caddis **VMCP API** to
LLM-based tools like Claude Desktop, Claude Code, and Cursor. It wraps read-only
endpoints covering equipment, production runs, cycles, telemetry, alarms, shift history,
org units, and more — and returns them in CSV/YAML so LLM context stays cheap.

## What it does

The LCM2M backend exposes a `/vmcp/*` namespace designed specifically for LLM
consumption: same data as the `/v1/*` API but serialized to CSV (when rows are
uniform) or YAML (when they're not) instead of verbose JSON. This MCP server is a
thin TypeScript wrapper that:

- Handles the two-step login (`POST /vmcp/sessions` → JWT) and caches the token
- Refreshes the token automatically before expiry, or on a 401 response
- Respects the backend's rate limits (429 → parse `Retry-After` → sleep → retry, with
  ±20% jitter and a configurable budget)
- Logs a warning to stderr when `X-RateLimit-Remaining-*` gets low
- Passes backend error bodies back to the LLM as `isError: true` tool results so the
  model can see what went wrong and correct itself

All tools are **read-only** (`readOnlyHint`, `idempotentHint`, `openWorldHint`).

## Requirements

- An LCM2M account (username, password; and optionally a `company_id` if your user
  belongs to multiple companies)
- Either **Node.js 25+** or **Docker**

## Configuration

Every knob is an environment variable. Credentials are the only ones you must set.

| Variable | Default | Description |
|---|---|---|
| `CADDIS_USERNAME` | *(required)* | LCM2M account username/email |
| `CADDIS_PASSWORD` | *(required)* | LCM2M account password |
| `CADDIS_COMPANY_ID` | *(auto)* | Required only if your user belongs to more than one company. The server tells you which IDs are valid if you omit it. |
| `CADDIS_API_URL` | `https://api.lcm2m.com` | Override for local/staging backends. The `/vmcp` and `/v1` prefixes are added by the client. |
| `CADDIS_MAX_RETRIES` | `3` | Max 429 retries per request |
| `CADDIS_MAX_RETRY_WAIT_MS` | `30000` | Max total wait budget per request before surfacing a 429 as an error |

## Setup

> **⚠️ This server is not a standalone program.** It speaks [MCP](https://modelcontextprotocol.io)
> over stdio, meaning it reads JSON-RPC from its **parent process's stdin** and writes responses
> to **stdout**. Launching any of the commands below directly in a terminal — `docker run …`,
> `node dist/index.js`, `npx lcm2m-caddis-mcp` — will just start the process and leave it sitting
> there waiting forever for a client to talk to it. **You always run this server in the context
> of an MCP client** (Claude Desktop, Claude Code, Cursor, the MCP Inspector, etc.), which spawns
> it as a child process and pipes its own stdin/stdout into the child.
>
> The three options below are the **install/build paths**. Each produces a command string that
> you then paste into your MCP client's config as the thing it should spawn. See
> [Using with MCP clients](#using-with-mcp-clients) for the actual wiring.

### Option 1: npx (recommended — zero install)

> **Status:** this package is not yet published to npm. Until it is, use Option 2
> (Docker) or Option 3 (local source) below. Once published, npx is the shortest path
> to a working setup.

The command string you'll give your MCP client is:

```sh
npx -y lcm2m-caddis-mcp
```

npx fetches the package on first use, caches it, and reuses the cache for subsequent
invocations. No clone, no build, no Docker. Credentials are injected by the client via
its `env` block — see [Using with MCP clients](#using-with-mcp-clients) for the full
config snippets.

### Option 2: Docker

Build the image locally:

```sh
git clone https://github.com/LCM2M/lcm2m-caddis-mcp.git
cd lcm2m-caddis-mcp
docker build --target runtime -t lcm2m-caddis-mcp .
```

Or use the npm script shortcut:

```sh
npm run docker:build
```

The command string you'll give your MCP client is:

```sh
docker run -i --rm \
  -e CADDIS_USERNAME \
  -e CADDIS_PASSWORD \
  -e CADDIS_COMPANY_ID \
  lcm2m-caddis-mcp
```

The `-i` (interactive stdin) flag is **required** — without it, Docker won't pipe the
client's stdin into the container and MCP handshakes will fail silently. `--rm` cleans
up the container when the client disconnects. Passing `-e VAR` without a value tells
Docker to forward `VAR` from the parent process's environment, which is how the MCP
client will hand in your credentials.

### Option 3: Local Node install (for development or running from source)

```sh
git clone https://github.com/LCM2M/lcm2m-caddis-mcp.git
cd lcm2m-caddis-mcp
npm install
npm run build
```

The command string you'll give your MCP client is:

```sh
node /absolute/path/to/lcm2m-caddis-mcp/dist/index.js
```

If you type that exact command into your terminal yourself, you'll see one line on
stderr (`lcm2m-caddis-mcp started (api=https://api.lcm2m.com)`) and then the process
will block on stdin forever. That's a successful boot — it's waiting for a client to
speak MCP. Ctrl-C to quit; use a client to actually use it.

## Using with MCP clients

All three setup options above produce a command string that speaks MCP over stdio.
Every MCP client has a slightly different config format, but the shape is the same:
tell the client to `spawn` the command, and inject the env vars.

The examples below use **npx** as the spawn command — it's the lowest-friction option
for end users, since it requires no clone, no build, and no Docker installation. If
you'd rather use Docker or a local install, see [Docker/local runtime variants](#dockerlocal-runtime-variants)
further down — the only thing that changes is the `command` and `args` fields.

### Claude Desktop

Edit your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "caddis": {
      "command": "npx",
      "args": ["-y", "lcm2m-caddis-mcp"],
      "env": {
        "CADDIS_USERNAME": "you@example.com",
        "CADDIS_PASSWORD": "your-password",
        "CADDIS_COMPANY_ID": "1"
      }
    }
  }
}
```

The `-y` flag tells npx to auto-accept its "install this package?" prompt. Without it,
npx blocks on a prompt that Claude Desktop can't answer, and the spawn hangs forever.
Keep your credentials in the `env` block — never put them in `args`, which some clients
log or echo.

Restart Claude Desktop after editing the config.

### Claude Code

The fastest path is the `claude mcp add` CLI:

```sh
claude mcp add caddis \
  --env CADDIS_USERNAME=you@example.com \
  --env CADDIS_PASSWORD='your-password' \
  --env CADDIS_COMPANY_ID=1 \
  -- npx -y lcm2m-caddis-mcp
```

Use `claude mcp list` to confirm it registered, and `claude mcp remove caddis` to
uninstall.

### Cursor

Create or edit `.cursor/mcp.json` in your workspace (or `~/.cursor/mcp.json` for global):

```json
{
  "mcpServers": {
    "caddis": {
      "command": "npx",
      "args": ["-y", "lcm2m-caddis-mcp"],
      "env": {
        "CADDIS_USERNAME": "you@example.com",
        "CADDIS_PASSWORD": "your-password",
        "CADDIS_COMPANY_ID": "1"
      }
    }
  }
}
```

### Docker / local runtime variants

If you've built the Docker image (Setup Option 2) or installed from source (Setup
Option 3), just swap out the `command` and `args` in any of the configs above. Everything
else — the `env` block, the client-specific wiring — stays the same.

**Docker:**
```json
"command": "docker",
"args": [
  "run", "-i", "--rm",
  "-e", "CADDIS_USERNAME",
  "-e", "CADDIS_PASSWORD",
  "-e", "CADDIS_COMPANY_ID",
  "lcm2m-caddis-mcp"
]
```

The `-e VAR` entries (with no value) tell Docker to **forward** the env var from the
parent process into the container. That's why the credentials still live in the `env`
block — the client sets them on the spawned Docker, and Docker pipes them through.

**Local Node:**
```json
"command": "node",
"args": ["/absolute/path/to/lcm2m-caddis-mcp/dist/index.js"]
```

For Claude Code's CLI, the equivalent swaps would be:

```sh
# Docker variant
claude mcp add caddis --env CADDIS_USERNAME=... [...] -- \
  docker run -i --rm -e CADDIS_USERNAME -e CADDIS_PASSWORD -e CADDIS_COMPANY_ID lcm2m-caddis-mcp

# Local Node variant
claude mcp add caddis --env CADDIS_USERNAME=... [...] -- \
  node /absolute/path/to/lcm2m-caddis-mcp/dist/index.js
```

### MCP Inspector (for debugging)

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is the
official interactive harness. Two modes:

**Web UI:**

```sh
npx @modelcontextprotocol/inspector \
  -e CADDIS_USERNAME=you@example.com \
  -e CADDIS_PASSWORD='your-password' \
  -e CADDIS_COMPANY_ID=1 \
  node /absolute/path/to/lcm2m-caddis-mcp/dist/index.js
```

**CLI (one-shot):**

```sh
npx @modelcontextprotocol/inspector --cli \
  node /absolute/path/to/lcm2m-caddis-mcp/dist/index.js \
  --method tools/call --tool-name caddis_list_equipment
```

## Available tools

All tools are prefixed with `caddis_`. Each maps to a single VMCP route; responses are
CSV (uniform rows) or YAML (nested/variable rows) — the backend picks based on shape.

### Company

| Tool | Summary |
|---|---|
| `caddis_get_company` | Company metadata (name, timezone, point-of-contact) |

### Devices

| Tool | Summary |
|---|---|
| `caddis_list_devices` | All Caddis hardware devices with attached equipment |
| `caddis_get_device` | One device by ID |

### Equipment

| Tool | Summary |
|---|---|
| `caddis_list_equipment` | All equipment for the active company |
| `caddis_get_equipment` | One equipment by ID |
| `caddis_get_equipment_utilization` | Bucketed utilization over a time window (`start`, `end?`, `interval?`, `tz?`) |
| `caddis_get_equipment_schedule` | Current schedule and inheritance source |
| `caddis_get_equipment_cycles` | Production cycles in a window (`start`, `end?`, `order?`, `limit?`) |
| `caddis_get_equipment_statuslogs` | Running/down log transitions (`start`, `end?`, `order?`, `limit?`) |
| `caddis_get_equipment_telemetry` | Raw telemetry points (`start`, `end?`, `order?`, `limit?`) |
| `caddis_get_equipment_shift_history` | Shift boundaries in a closed window (`start`, `end` both required) |
| `caddis_list_equipment_excessive_downtimes` | XSF events for one equipment over a closed window |
| `caddis_get_equipment_excessive_downtime` | One XSF event by `shiftHistoryId` + `statusLogId` |

### Org units and tree

| Tool | Summary |
|---|---|
| `caddis_get_org_unit` | One org unit with its equipment and direct children |
| `caddis_get_org_unit_schedule` | Org unit schedule with inheritance source |
| `caddis_list_org_unit_excessive_downtimes` | XSF events for every equipment under an org unit |
| `caddis_get_tree` | Full org-unit / equipment tree (or a subtree if `orgUnitId` is given) |

### Alarms

| Tool | Summary |
|---|---|
| `caddis_list_alarms` | Enabled alarms, optionally filtered by `equipIds[]` or `pm` (preventative-maintenance) |

### Tags / tag groups

| Tool | Summary |
|---|---|
| `caddis_list_tags` | Cycle tags, optionally filtered by `active` or `tagGroupId` |
| `caddis_get_tag` | One tag by ID |
| `caddis_list_tag_groups` | All tag groups |
| `caddis_get_tag_group` | One tag group by ID |

### Runs

| Tool | Summary |
|---|---|
| `caddis_list_runs` | Production runs, optionally filtered by `equipment_id` / `start` / `end` |
| `caddis_get_run` | One run by ID |
| `caddis_get_run_cycles` | All cycles belonging to a specific run |

### Status reasons

| Tool | Summary |
|---|---|
| `caddis_list_status_reasons` | Status reason catalog (used to decode `statuslogs` responses) |

## Development

### Clone and install

```sh
git clone https://github.com/YOUR-ORG/lcm2m-caddis-mcp.git
cd lcm2m-caddis-mcp
npm install
```

### Configure local environment

```sh
cp .env.example .env.local
# edit .env.local with your real CADDIS_USERNAME / CADDIS_PASSWORD / CADDIS_API_URL
```

`.env.local` is gitignored. For local development against a local `lcm2m-backend`, set
`CADDIS_API_URL=http://localhost:3002` (or whatever port the backend serves on).

### Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Launches the MCP Inspector web UI and spawns the server via `tsx` (TypeScript, no build step). Reads `.env.local` via `--env-file`. |
| `npm run build` | Compiles TypeScript to `dist/` |
| `npm run start` | Runs the compiled server (`node dist/index.js`) — you'll need to set env vars yourself |
| `npm run typecheck` | Type-only compile (`tsc --noEmit`) |
| `npm run lint` | Biome check (lint + format + import sort) |
| `npm run lint:fix` | Auto-fix whatever Biome can |
| `npm run format` | Biome format only |
| `npm test` | Node's built-in test runner via `tsx --test` (~38 tests, ~400ms) |
| `npm run docker:build` | `docker build --target runtime -t lcm2m-caddis-mcp .` |

### Dev loop with MCP Inspector

The Inspector is the fastest way to iterate. It spawns the server as a stdio
subprocess and gives you a web UI to call tools, inspect responses, and replay
requests.

```sh
cp .env.example .env.local
# edit with real creds
npm run dev
```

Open the URL it prints (something like
`http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=...`) in a **Chromium-based browser**
(Chrome, Brave, Edge). Firefox has known rendering issues with the Inspector's React
bundle.

Click **Connect** — the sidebar pre-fills with `tsx --env-file=.env.local src/index.ts`
(via localStorage after the first run). The Tools tab shows every registered tool, and `Run Tool`
fires them with the inputs you specify.

To iterate on tool code, edit the file, click **Restart** in the Inspector sidebar,
and re-run the tool. `tsx` picks up source changes on restart.

### Running tests

```sh
npm test
```

38 tests across two files:

- `src/client.test.ts` — pure helper tests (`buildQueryString`, `parseRetryWaitMs`,
  `applyJitter`, `decodeJwtExp`) and integration tests for `CaddisApiClient` with a
  mocked `fetch` injected via constructor. Covers lazy login, 401 re-login retry,
  429 retry loop, concurrent login dedup, JWT expiry refresh, `CompanySelectionRequiredError`,
  and body passthrough for `vmcp`/`v1`/`v1Json`.
- `src/tools/schemas.test.ts` — `runTool` error classification (4xx → `isError`,
  5xx/non-`ApiError` → rethrow).

Uses Node 22's built-in test runner — no Vitest, Jest, or Mocha dep.

### Project layout

```
src/
  index.ts                          # MCP server entry (stdio transport)
  config.ts                         # zod env config
  client.ts                         # CaddisApiClient: login, retry, rate-limit handling
  client.test.ts                    # Tier 1 + Tier 2 client tests
  tools/
    schemas.ts                      # Shared zod helpers + runTool error wrapper
    schemas.test.ts                 # runTool tests
    index.ts                        # registers every tool
    wrappers/                       # 1:1 VMCP route wrappers
      company.ts     (1 tool)
      devices.ts     (2 tools)
      equipment.ts   (10 tools)
      orgunits.ts    (4 tools)
      alarms.ts      (1 tool)
      tags.ts        (2 tools)
      taggroups.ts   (2 tools)
      runs.ts        (3 tools)
      statusreasons.ts (1 tool)
    composite/
      index.ts                      # Seam for higher-level multi-call tools (empty today)
```

## Architecture notes

### Auth flow

1. First request triggers `POST {CADDIS_API_URL}/vmcp/sessions` with username/password
   (+ `company_id` if set)
2. Backend returns `{ token: <JWT> }`. Token's `exp` claim is decoded and cached
3. Subsequent requests send `Authorization: <raw JWT>` — **no `Bearer` prefix**. The
   LCM2M authorizer verifies the header value directly as a JWT.
4. 401 → clear cache → re-login once → retry the request
5. If the cached token is within 30 seconds of expiry, proactively re-login before
   the next request
6. Concurrent first-requests share a single in-flight login promise (no stampede)

### Rate limiting

The backend applies two parallel buckets per request via `rate-limiter-flexible`:

- **endpoint bucket**: 20 pts / 10s keyed on `{userId}-{companyId}-{email}-{route}` →
  ~2 req/s per tool per user
- **user bucket**: 60 pts / 10s keyed on `{userId}-{companyId}-{email}` → ~6 req/s
  total per user

On throttle the backend returns **429** with `Retry-After: <seconds>`. The client:

1. Parses `Retry-After` (or falls back to `X-RateLimit-Reset-{endpoint,user}` — picks
   the minimum)
2. Applies ±20% jitter so concurrent retries don't stampede
3. Sleeps and retries up to `CADDIS_MAX_RETRIES` times
4. Enforces a total-wait cap of `CADDIS_MAX_RETRY_WAIT_MS` per request
5. Logs each retry to stderr
6. Logs a low-remaining warning on any successful response where either bucket is
   `≤ 3` remaining

When retries exhaust, the 429 is surfaced to the tool handler's `runTool` wrapper,
which converts it into `{ isError: true, content: [{ type: 'text', text: '...body...' }] }`
so the LLM sees the backend's error body and can react.

### Response format

VMCP endpoints return **CSV** when all rows have the same shape and **YAML** when
they don't. The server passes the raw body through unchanged — no JSON re-serialization.
This is a deliberate token optimization: a 300-row CSV is ~3× cheaper in tokens than
the equivalent JSON array.

Tool handlers shouldn't try to parse the body; just return it as `text` content and
let the LLM read it.

## Adding new tools

### Wrapper tools (1:1 VMCP routes)

Pick the appropriate file in `src/tools/wrappers/` (or create a new one if the resource
is genuinely new). Example for a hypothetical `GET /vmcp/foo/:id`:

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';
import { encodePathSegment, idParam, readOnlyAnnotations, runTool } from '../schemas.js';

export function registerFooTools(server: McpServer, client: CaddisApiClient): void {
  server.registerTool(
    'caddis_get_foo',
    {
      title: 'Get one foo',
      description: 'Short description the LLM will read.',
      inputSchema: { fooId: idParam },
      annotations: readOnlyAnnotations,
    },
    async ({ fooId }) =>
      runTool(async () => {
        const { body } = await client.vmcp(`/foo/${encodePathSegment(fooId)}`);
        return body;
      }),
  );
}
```

Then wire it up in `src/tools/index.ts`:

```ts
import { registerFooTools } from './wrappers/foo.js';
// ...
registerFooTools(server, client);
```

Shared zod helpers for common input shapes live in `src/tools/schemas.ts`:

- `idParam` — accepts string or number
- `isoDate` — `z.string().datetime({ offset: true })`
- `orderEnum` — `z.enum(['ASC', 'DESC'])`
- `timeWindowRequiredStart` — `{ start (required), end?, order?, limit? }`
- `timeWindowRequired` — `{ start, end }` both required
- `readOnlyAnnotations` — the `readOnlyHint`/`idempotentHint`/`openWorldHint` triple
- `encodePathSegment` — URL-encodes a path segment
- `runTool` — the 4xx/5xx error classification wrapper

### Composite tools (higher-level workflows)

For tools that aren't 1:1 VMCP wrappers — e.g. a "show me the last 24h summary of
equipment X" tool that fetches equipment + utilization + shift history in one call
and synthesizes a report — add a file under `src/tools/composite/` and register it
from `src/tools/composite/index.ts` → `registerCompositeTools()`.

Composite tools get the same `CaddisApiClient` and can call:

- `client.vmcp(path, { query })` — VMCP (CSV/YAML body, `text` passthrough)
- `client.v1(path, { query })` — raw v1 JSON as text
- `client.v1Json<T>(path, { query })` — v1 parsed as typed JSON, for when you need
  to operate on the data before returning

The idea is to let contributors build workflows that span multiple endpoints without
dumping composite logic into wrapper files, where it would mix with the 1:1 route
wrappers and be harder to find.

## Troubleshooting

**`Missing credentials. Set CADDIS_USERNAME and CADDIS_PASSWORD`** — exactly what it
says. Check that the env vars are actually getting into the child process (`docker
run -e VAR` passes by reference, so `VAR` must also be set in the parent shell).

**`This user belongs to multiple companies. Set CADDIS_COMPANY_ID to one of: 1: Acme, 2: Beta`**
— set `CADDIS_COMPANY_ID` to the numeric ID of the company you want.

**`401 Unauthorized` on every tool call** — likely a bad username/password, or the
wrong `CADDIS_API_URL`. Check `https://<your-api>/vmcp/sessions` accepts your creds
via `curl`:

```sh
curl -X POST https://api.lcm2m.com/vmcp/sessions \
  -H 'Content-Type: application/json' \
  -d '{"username":"you@example.com","password":"your-password","company_id":1}'
```

You should see `{"token":"eyJ..."}`.

**`429 Too Many Requests`** eventually surfacing as `isError: true` — your session is
making requests faster than the backend allows (20/10s per endpoint, 60/10s overall).
Increase `CADDIS_MAX_RETRY_WAIT_MS` if you're OK with slower tool calls, or back off
the tool-call rate from the client side.

**Blank page in Firefox when running `npm run dev`** — the MCP Inspector UI has a
rendering issue in non-Chromium browsers. Use Chrome/Brave/Edge, or use
`npx @modelcontextprotocol/inspector --cli ...` (see the Inspector section above) to
bypass the browser entirely.
