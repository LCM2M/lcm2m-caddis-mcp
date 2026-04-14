import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CaddisApiClient } from '../../client.js';

// Composite tools are multi-step or multi-endpoint helpers that aren't 1:1 wrappers around a
// single VMCP route. They use the same `CaddisApiClient` but compose vmcp/v1/v1Json calls and
// synthesize a higher-level response. Register new composite tools from this function; each
// one should live in its own file under `src/tools/composite/*.ts` and be imported here.
export function registerCompositeTools(_server: McpServer, _client: CaddisApiClient): void {
  // No composite tools yet. Add registrations here as higher-level workflows emerge.
}
