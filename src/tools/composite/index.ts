import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Config } from '../../config.js';
import type { ToolHandlerRegistry } from '../registry.js';
import { registerBatchTool } from './batch.js';

// Composite tools are multi-step or multi-endpoint helpers that aren't 1:1 wrappers around a
// single VMCP route. Register new composite tools from this function; each one should live in
// its own file under `src/tools/composite/*.ts` and be imported here.
export function registerCompositeTools(
  server: McpServer,
  registry: ToolHandlerRegistry,
  config: Config,
): void {
  registerBatchTool(server, registry, config);
}
