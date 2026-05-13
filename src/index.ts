#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CaddisApiClient } from './client.js';
import { loadConfig } from './config.js';
import { registerAllTools } from './tools/index.js';
import { TOON_PRIMER } from './tools/schemas.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new CaddisApiClient(config);

  const server = new McpServer(
    { name: 'lcm2m-caddis-mcp', version: '0.1.0' },
    {
      instructions: `Read-only access to the LCM2M Caddis VM2M API.\n\n${TOON_PRIMER}`,
    },
  );

  registerAllTools(server, client, config);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`lcm2m-caddis-mcp started (api=${config.apiUrl})`);
}

main().catch((err) => {
  console.error('Fatal error starting MCP server:', err);
  process.exit(1);
});
