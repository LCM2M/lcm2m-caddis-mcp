# lcm2m-caddis-mcp

An MCP server that exposes the LCM2M Caddis **VMCP API** to LLM tools like Claude
Desktop, Claude Code, and Cursor. Read-only wrappers over equipment, runs, cycles,
telemetry, alarms, and more — served as CSV/YAML so LLM context stays cheap.

## Requirements

- An LCM2M account (username, password, and `CADDIS_COMPANY_ID` if your user belongs
  to more than one company)
- **Node.js 25+** or **Docker**

## Configuration

| Variable | Default | Description |
|---|---|---|
| `CADDIS_USERNAME` | *(required)* | LCM2M account username/email |
| `CADDIS_PASSWORD` | *(required)* | LCM2M account password |
| `CADDIS_COMPANY_ID` | *(auto)* | Required if your user belongs to multiple companies |
| `CADDIS_API_URL` | `https://api.lcm2m.com` | Override for local/staging backends |
| `CADDIS_MAX_RETRIES` | `3` | Max 429 retries per request |
| `CADDIS_MAX_RETRY_WAIT_MS` | `30000` | Max total wait budget per request |

## Install

This server speaks MCP over stdio — it's spawned by an MCP client, not run
standalone. Pick one install path; the resulting command string feeds into your
client's config.

### npx (recommended, once published)

```sh
npx -y lcm2m-caddis-mcp
```

> Not yet on npm. Use Docker or local source until it is.

### Docker

```sh
git clone https://github.com/LCM2M/lcm2m-caddis-mcp.git
cd lcm2m-caddis-mcp
docker build --target runtime -t lcm2m-caddis-mcp .
```

Command string:

```sh
docker run -i --rm -e CADDIS_USERNAME -e CADDIS_PASSWORD -e CADDIS_COMPANY_ID lcm2m-caddis-mcp
```

### Local Node

```sh
git clone https://github.com/LCM2M/lcm2m-caddis-mcp.git
cd lcm2m-caddis-mcp
npm install
npm run build
```

Command string: `node /absolute/path/to/lcm2m-caddis-mcp/dist/index.js`

## Using with MCP clients

### Claude Code

```sh
claude mcp add caddis \
  --env CADDIS_USERNAME=you@example.com \
  --env CADDIS_PASSWORD='your-password' \
  --env CADDIS_COMPANY_ID=1 \
  -- npx -y lcm2m-caddis-mcp
```

### Claude Desktop / Cursor

Edit `claude_desktop_config.json` (Claude Desktop) or `.cursor/mcp.json` (Cursor):

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

Swap `command`/`args` for Docker or local Node as needed. Restart the client after
editing config.

## Available tools

All tools are **read-only** and prefixed with `caddis_`. Each maps 1:1 to a VMCP
route; responses are CSV (uniform rows) or YAML (nested).

- **Company:** `get_company`
- **Devices:** `list_devices`, `get_device`
- **Equipment:** `list_equipment`, `get_equipment`, `get_equipment_utilization`,
  `get_equipment_schedule`, `get_equipment_cycles`, `get_equipment_statuslogs`,
  `get_equipment_telemetry`, `get_equipment_shift_history`,
  `list_equipment_excessive_downtimes`, `get_equipment_excessive_downtime`
- **Org units / tree:** `get_org_unit`, `get_org_unit_schedule`,
  `list_org_unit_excessive_downtimes`, `get_tree`
- **Alarms:** `list_alarms`
- **Tags:** `list_tags`, `get_tag`, `list_tag_groups`, `get_tag_group`
- **Runs:** `list_runs`, `get_run`, `get_run_cycles`
- **Status reasons:** `list_status_reasons`

## Development

```sh
cp .env.example .env.local  # fill in creds
npm install
npm run dev                 # MCP Inspector web UI + tsx
npm test                    # node --test via tsx
npm run build               # tsc -> dist/
npm run typecheck
npm run lint                # biome check
```

`npm run dev` opens the MCP Inspector in a **Chromium browser** (Firefox has
rendering issues). Edit source, click **Restart**, re-run the tool.

### Project layout

```
src/
  index.ts         # MCP server entry (stdio)
  config.ts        # zod env config
  client.ts        # CaddisApiClient: login, retry, rate-limit
  tools/
    schemas.ts     # shared zod helpers + runTool error wrapper
    index.ts       # tool registration
    wrappers/      # 1:1 VMCP route wrappers
    composite/     # higher-level multi-call tools
```

## How it works

- **Auth:** first call hits `POST /vmcp/sessions` → JWT, cached and proactively
  refreshed 30s before expiry. 401 triggers a single re-login + retry. The
  `Authorization` header carries the raw JWT (no `Bearer` prefix).
- **Rate limiting:** backend enforces 20 req/10s per endpoint and 60 req/10s per
  user. On 429, the client parses `Retry-After`, applies ±20% jitter, and retries
  up to `CADDIS_MAX_RETRIES` (capped by `CADDIS_MAX_RETRY_WAIT_MS`).
- **Response format:** CSV when rows are uniform, YAML otherwise. The raw body is
  passed through — ~3× cheaper in tokens than equivalent JSON.
- **Errors:** 4xx responses surface as `isError: true` tool results so the LLM can
  see the backend error body and recover; 5xx rethrow.

## Troubleshooting

- **`Missing credentials`** — `CADDIS_USERNAME` / `CADDIS_PASSWORD` aren't reaching
  the child process. With `docker run -e VAR`, `VAR` must also be set in the parent
  shell.
- **`This user belongs to multiple companies…`** — set `CADDIS_COMPANY_ID` to one
  of the numeric IDs listed in the error.
- **`401 Unauthorized`** — bad creds or wrong `CADDIS_API_URL`. Test with:
  ```sh
  curl -X POST https://api.lcm2m.com/vmcp/sessions \
    -H 'Content-Type: application/json' \
    -d '{"username":"you@example.com","password":"...","company_id":1}'
  ```
- **Persistent `429`** — raise `CADDIS_MAX_RETRY_WAIT_MS` or back off the client's
  call rate.
- **Blank Inspector page in Firefox** — use Chrome/Brave/Edge, or
  `npx @modelcontextprotocol/inspector --cli ...`.
